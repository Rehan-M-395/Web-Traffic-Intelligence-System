const crypto = require("crypto");
const sql = require("../../neon_connection");

const DEDUPE_WINDOW_SECONDS = 120;
const QUERY_LIMIT_DEFAULT = 50;
const RANGE_TO_INTERVAL = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days"
};

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeUuid(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value) ? value : null;
}

function trackingLog(label, payload) {
  const debugEnabled = process.env.TRACKING_DEBUG !== "false";
  if (debugEnabled) {
    console.log(`[tracking] ${label}`, payload);
  }
}

function sanitizeText(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function extractOsPlatform(userAgent, platformHint) {
  const ua = (userAgent || "").toLowerCase();
  const platform = (platformHint || "").toLowerCase();

  if (platform.includes("win") || ua.includes("windows")) return "Windows";
  if (platform.includes("mac") || ua.includes("mac os")) return "MacOS";
  if (platform.includes("linux") || ua.includes("linux")) return "Linux";
  if (platform.includes("android") || ua.includes("android")) return "Android";
  if (platform.includes("iphone") || platform.includes("ipad") || ua.includes("iphone")) return "iOS";
  return null;
}

function buildFingerprintPayload(input) {
  const fields = [
    sanitizeText(input.userAgent),
    sanitizeText(input.platform),
    sanitizeText(input.screenResolution),
    sanitizeText(input.timezone),
    sanitizeText(input.language)
  ].filter(Boolean);

  return fields.join("|");
}

function normalizeLocation(rawLocation = {}) {
  const latitude = Number(rawLocation.latitude);
  const longitude = Number(rawLocation.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  const rawType = rawLocation.locationType || rawLocation.source;
  const locationType = rawType === "precise" && hasCoords ? "precise" : "approximate";

  return {
    latitude: hasCoords ? latitude : null,
    longitude: hasCoords ? longitude : null,
    locationType,
    city: rawLocation.city ? sanitizeText(rawLocation.city) : null,
    country: rawLocation.country ? sanitizeText(rawLocation.country) : null
  };
}

async function fetchIpGeo(ipAddress) {
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ipAddress)}`);
    if (!response.ok) {
      return {};
    }

    const body = await response.json();
    if (!body || body.success === false) {
      return {};
    }

    return {
      city: body.city || null,
      country: body.country || null,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null
    };
  } catch {
    return {};
  }
}

async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "WebTrafficIntelligence/1.0"
      }
    });
    if (!response.ok) {
      return {};
    }

    const body = await response.json();
    const address = body?.address || {};
    return {
      city:
        address.city ||
        address.town ||
        address.village ||
        address.hamlet ||
        null,
      country: address.country || null
    };
  } catch {
    return {};
  }
}

async function enrichLocation(ipAddress, location, preciseAllowed) {
  const ipGeo = await fetchIpGeo(ipAddress);
  const next = { ...location };

  if (preciseAllowed && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    const reverse = await reverseGeocode(location.latitude, location.longitude);
    next.city = next.city || reverse.city || ipGeo.city || null;
    next.country = next.country || reverse.country || ipGeo.country || null;
    next.locationType = "precise";
    return next;
  }

  next.latitude = Number.isFinite(location.latitude) ? location.latitude : ipGeo.latitude ?? null;
  next.longitude = Number.isFinite(location.longitude) ? location.longitude : ipGeo.longitude ?? null;
  next.city = next.city || ipGeo.city || null;
  next.country = next.country || ipGeo.country || null;
  next.locationType = "approximate";

  if (!next.city && !next.country && next.latitude == null && next.longitude == null) {
    next.city = "Unknown";
    next.country = "Unknown";
  }

  return next;
}

async function findRecentDuplicate(visitorId) {
  const rows = await sql`
    SELECT *
    FROM user_tracking_events
    WHERE visitor_id = ${visitorId}
      AND created_at > NOW() - (${DEDUPE_WINDOW_SECONDS} * INTERVAL '1 second')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

async function detectSuspicious(visitorId, ipAddress, country) {
  const reasons = [];
  const checks = await sql`
    WITH recent AS (
      SELECT ip_address, country
      FROM user_tracking_events
      WHERE visitor_id = ${visitorId}
      ORDER BY created_at DESC
      LIMIT 30
    )
    SELECT
      COUNT(DISTINCT ip_address) AS unique_ips,
      COUNT(DISTINCT COALESCE(country, 'Unknown')) AS unique_countries,
      (
        SELECT country FROM user_tracking_events
        WHERE visitor_id = ${visitorId}
        ORDER BY created_at DESC
        LIMIT 1
      ) AS previous_country
    FROM recent
  `;

  const summary = checks[0] || {};
  const uniqueIps = Number(summary.unique_ips || 0);
  const uniqueCountries = Number(summary.unique_countries || 0);
  const previousCountry = summary.previous_country;

  if (uniqueIps >= 2) {
    reasons.push("multiple-ips");
  }

  if (uniqueCountries >= 2) {
    reasons.push("multi-country-history");
  }

  if (previousCountry && country && previousCountry !== country) {
    reasons.push("sudden-country-change");
  }

  if (uniqueIps >= 3) {
    reasons.push("rapid-ip-rotation");
  }

  return {
    suspicious: reasons.length > 0,
    reasons
  };
}

function mapTrackingRow(row) {
  return {
    id: String(row.id),
    visitorId: row.visitor_id,
    fingerprintHash: row.fingerprint_hash,
    device: {
      userAgent: row.user_agent,
      osPlatform: row.os_platform,
      screenResolution: row.screen_resolution,
      timezone: row.timezone,
      language: row.language
    },
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      city: row.city,
      country: row.country,
      ipAddress: row.ip_address,
      locationType:
        row.location_source === "precise" ? "precise" : "approximate"
    },
    suspicious: row.suspicious,
    suspiciousReasons: Array.isArray(row.suspicious_reasons)
      ? row.suspicious_reasons
      : JSON.parse(row.suspicious_reasons || "[]"),
    timestamp: row.created_at
  };
}

async function trackUser(payload, ipAddress) {
  const userAgent = sanitizeText(payload.userAgent);
  const osPlatform = extractOsPlatform(payload.userAgent, payload.platform);
  const platform = sanitizeText(payload.platform);
  const screenResolution = sanitizeText(payload.screenResolution);
  const timezone = sanitizeText(payload.timezone);
  const language = sanitizeText(payload.language);
  const locationInput = normalizeLocation(payload.location);
  const preciseLocationAllowed = Boolean(payload.preciseLocationAllowed);
  const fingerprintSeed = buildFingerprintPayload({
    userAgent,
    platform,
    screenResolution,
    timezone,
    language
  });
  const requestedVisitorId = sanitizeText(payload.visitorId);
  const fingerprintBase =
    fingerprintSeed || requestedVisitorId || `${Date.now()}|${Math.random()}`;
  const fingerprintHash = sanitizeText(payload.fingerprintHash) || stableHash(fingerprintBase);
  const visitorId =
    requestedVisitorId || stableHash(`visitor|${fingerprintHash}`).slice(0, 20);
  const normalizedUid = normalizeUuid(payload.uid);

  trackingLog("processed-payload", {
    visitorId,
    userAgent,
    platform,
    osPlatform,
    screenResolution,
    timezone,
    language,
    locationInput,
    ipAddress
  });

  const duplicate = await findRecentDuplicate(visitorId);
  if (duplicate) {
    return {
      duplicate: true,
      event: mapTrackingRow(duplicate)
    };
  }

  const location = await enrichLocation(ipAddress, locationInput, preciseLocationAllowed);
  const suspiciousResult = await detectSuspicious(visitorId, ipAddress, location.country);

  const insertObject = {
    visitorId,
    fingerprintHash,
    userAgent,
    osPlatform,
    screenResolution,
    timezone,
    language,
    latitude: location.latitude,
    longitude: location.longitude,
    city: location.city,
    country: location.country,
    ipAddress,
    locationType: location.locationType,
    preciseLocationAllowed,
    uid: normalizedUid,
    suspicious: suspiciousResult.suspicious,
    suspiciousReasons: suspiciousResult.reasons
  };
  trackingLog("final-insert-object", insertObject);

  const inserted = await sql`
    INSERT INTO user_tracking_events (
      visitor_id,
      fingerprint_hash,
      user_agent,
      os_platform,
      screen_resolution,
      timezone,
      language,
      latitude,
      longitude,
      city,
      country,
      ip_address,
      location_source,
      precise_location_allowed,
      suspicious,
      suspicious_reasons,
      metadata
    )
    VALUES (
      ${visitorId},
      ${fingerprintHash},
      ${userAgent},
      ${osPlatform},
      ${screenResolution},
      ${timezone},
      ${language},
      ${location.latitude},
      ${location.longitude},
      ${location.city},
      ${location.country},
      ${ipAddress},
      ${location.locationType},
      ${preciseLocationAllowed},
      ${suspiciousResult.suspicious},
      ${JSON.stringify(suspiciousResult.reasons)},
      ${JSON.stringify({
        consentShown: true,
        locationCaptureMethod: location.locationType,
        uid: normalizedUid
      })}
    )
    RETURNING *
  `;

  return {
    duplicate: false,
    event: mapTrackingRow(inserted[0])
  };
}

async function getTrackingDashboard(limit = QUERY_LIMIT_DEFAULT) {
  const options = typeof limit === "object" ? limit : { limit };
  const safeLimit = Math.min(Math.max(Number(options.limit) || QUERY_LIMIT_DEFAULT, 1), 300);
  const hasCustomRange = Boolean(options.from || options.to);
  const rangeKey = RANGE_TO_INTERVAL[options.range] ? options.range : "24h";
  const fromDate = options.from ? new Date(options.from) : null;
  const toDate = options.to ? new Date(options.to) : null;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

  const buildRangeRowsQuery = () => {
    if (validFrom && validTo) {
      return sql`
        SELECT *
        FROM user_tracking_events
        WHERE created_at >= ${validFrom}
          AND created_at <= ${validTo}
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `;
    }

    if (validFrom) {
      return sql`
        SELECT *
        FROM user_tracking_events
        WHERE created_at >= ${validFrom}
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `;
    }

    if (validTo) {
      return sql`
        SELECT *
        FROM user_tracking_events
        WHERE created_at <= ${validTo}
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `;
    }

    const interval = RANGE_TO_INTERVAL[rangeKey];
    return sql`
      SELECT *
      FROM user_tracking_events
      WHERE created_at >= NOW() - ${interval}::interval
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `;
  };

  const buildRangeSummaryQuery = () => {
    if (validFrom && validTo) {
      return sql`
        SELECT
          COUNT(*) AS total_records,
          COUNT(DISTINCT visitor_id) AS unique_visitors,
          COUNT(*) FILTER (WHERE suspicious = TRUE) AS suspicious_records
        FROM user_tracking_events
        WHERE created_at >= ${validFrom}
          AND created_at <= ${validTo}
      `;
    }

    if (validFrom) {
      return sql`
        SELECT
          COUNT(*) AS total_records,
          COUNT(DISTINCT visitor_id) AS unique_visitors,
          COUNT(*) FILTER (WHERE suspicious = TRUE) AS suspicious_records
        FROM user_tracking_events
        WHERE created_at >= ${validFrom}
      `;
    }

    if (validTo) {
      return sql`
        SELECT
          COUNT(*) AS total_records,
          COUNT(DISTINCT visitor_id) AS unique_visitors,
          COUNT(*) FILTER (WHERE suspicious = TRUE) AS suspicious_records
        FROM user_tracking_events
        WHERE created_at <= ${validTo}
      `;
    }

    const interval = RANGE_TO_INTERVAL[rangeKey];
    return sql`
      SELECT
        COUNT(*) AS total_records,
        COUNT(DISTINCT visitor_id) AS unique_visitors,
        COUNT(*) FILTER (WHERE suspicious = TRUE) AS suspicious_records
      FROM user_tracking_events
      WHERE created_at >= NOW() - ${interval}::interval
    `;
  };

  const [rows, summary] = await Promise.all([
    buildRangeRowsQuery(),
    buildRangeSummaryQuery()
  ]);
  const currentRow = rows.length ? [rows[0]] : [];

  return {
    current: currentRow[0] ? mapTrackingRow(currentRow[0]) : null,
    records: rows.map(mapTrackingRow),
    summary: {
      totalRecords: Number(summary[0]?.total_records || 0),
      uniqueVisitors: Number(summary[0]?.unique_visitors || 0),
      suspiciousRecords: Number(summary[0]?.suspicious_records || 0)
    },
    timeFilter: hasCustomRange
      ? {
          type: "custom",
          from: validFrom ? validFrom.toISOString() : null,
          to: validTo ? validTo.toISOString() : null
        }
      : {
          type: "preset",
          range: rangeKey
        }
  };
}

module.exports = {
  trackUser,
  getTrackingDashboard
};
