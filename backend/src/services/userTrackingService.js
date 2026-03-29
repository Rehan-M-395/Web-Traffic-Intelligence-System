const crypto = require("crypto");
const sql = require("../../neon_connection");
const { detectVpn } = require("./vpnIntelService");

// 👉 If Node < 18, uncomment below
// const fetch = require("node-fetch");

const DEDUPE_WINDOW_SECONDS = 120;
const geoCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sanitizeText(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const t = value.trim();
  return t ? t : fallback;
}

function normalizeIp(value) {
  const text = sanitizeText(value);
  if (!text) return null;
  return text.replace(/^::ffff:/, "");
}

/* ======================================================
   🌍 FIXED IP GEO (MAIN ISSUE SOLVED HERE)
====================================================== */
async function fetchIpGeo(ip) {
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {

    // =========================
    // ✅ PRIMARY API (ipwho.is)
    // =========================
    let response = await fetch(`https://ipwho.is/${ip}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    let text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }

    if (data.success && data.city) {
      const result = {
        city: data.city,
        country: data.country,
        latitude: data.latitude,
        longitude: data.longitude
      };
      geoCache.set(ip, {
        data: result,
        timestamp: Date.now()
      });
      return result;
    }

    // =========================
    // 🔁 FALLBACK 1 (BEST FOR IPv6)
    // =========================
    response = await fetch(`https://ipapi.co/${ip}/json/`);
    data = await response.json();

    if (data.city) {
      const result = {
        city: data.city,
        country: data.country_name,
        latitude: data.latitude,
        longitude: data.longitude
      };
      geoCache.set(ip, {
        data: result,
        timestamp: Date.now()
      });
      return result;
    }

    // =========================
    // 🔁 FALLBACK 2 (FINAL)
    // =========================
    response = await fetch(`https://freeipapi.com/api/json/${ip}`);
    data = await response.json();
    const result = {
      city: data.cityName || null,
      country: data.countryName || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null
    };
    if (result.city || result.country || result.latitude || result.longitude) {
      geoCache.set(ip, {
        data: result,
        timestamp: Date.now()
      });
    }
    return result;

  } catch {
    return {};
  }
}
/* ======================================================
   LOCATION ENRICHMENT
====================================================== */
async function enrichLocation(ipAddress, location) {
  const ipGeo = await fetchIpGeo(ipAddress);

  console.log("📍 ENRICHED LOCATION:", ipGeo);

  return {
    latitude: ipGeo.latitude ?? null,
    longitude: ipGeo.longitude ?? null,
    city: ipGeo.city || "Unknown",
    country: ipGeo.country || "Unknown",
    locationType: "approximate",
  };
}

/* ======================================================
   DUPLICATE CHECK
====================================================== */
async function findRecentDuplicate(visitorId) {
  const rows = await sql`
    SELECT * FROM user_tracking_events
    WHERE visitor_id = ${visitorId}
      AND created_at > NOW() - (${DEDUPE_WINDOW_SECONDS} * INTERVAL '1 second')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

/* ======================================================
   MAIN TRACK FUNCTION
====================================================== */
async function trackUser(payload, ipAddress) {
  const userAgent = sanitizeText(payload.userAgent);
  const platform = sanitizeText(payload.platform);
  const screenResolution = sanitizeText(payload.screenResolution);
  const timezone = sanitizeText(payload.timezone);
  const language = sanitizeText(payload.language);

  const requestIp = normalizeIp(ipAddress) || "0.0.0.0";

  const fingerprintBase =
    userAgent +
    "|" +
    platform +
    "|" +
    screenResolution +
    "|" +
    timezone +
    "|" +
    language;

  const fingerprintHash = stableHash(fingerprintBase);
  const visitorId = stableHash("visitor|" + fingerprintHash).slice(0, 20);

  console.log("👤 Visitor:", visitorId);

  // 🌍 FIXED LOCATION
  const location = await enrichLocation(requestIp);

  // 🔐 VPN Detection
  const vpnData = await detectVpn(requestIp);

  // 🔁 DUPLICATE CHECK
  const duplicate = await findRecentDuplicate(visitorId);
  if (duplicate) {
    return {
      duplicate: true,
      event: duplicate,
    };
  }

  // 🚨 SIMPLE SUSPICIOUS CHECK
  const suspicious = vpnData?.isVpn === true;

  // 💾 INSERT
  const inserted = await sql`
    INSERT INTO user_tracking_events (
      visitor_id,
      fingerprint_hash,
      user_agent,
      screen_resolution,
      timezone,
      language,
      latitude,
      longitude,
      city,
      country,
      ip_address,
      vpn_detected,
      vpn_confidence,
      vpn_type,
      isp,
      suspicious,
      suspicious_reasons
    )
    VALUES (
      ${visitorId},
      ${fingerprintHash},
      ${userAgent},
      ${screenResolution},
      ${timezone},
      ${language},
      ${location.latitude},
      ${location.longitude},
      ${location.city},
      ${location.country},
      ${requestIp},
      ${vpnData?.isVpn},
      ${vpnData?.confidence},
      ${vpnData?.vpnType},
      ${vpnData?.isp},
      ${suspicious},
      ${JSON.stringify(suspicious ? ["vpn"] : [])}
    )
    RETURNING *
  `;

  console.log("🧾 FINAL DATA GOING TO DB:", {
    location,
    vpnData,
    requestIp
  })

  return {
    duplicate: false,
    event: inserted[0],
  };
}

async function getTrackingDashboard(options = {}) {
  const safeLimit = Math.min(
    Math.max(Number(options.limit) || 50, 1),
    300
  );

  const rows = await sql`
    SELECT *
    FROM user_tracking_events
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;

  console.log("📊 SAFE LIMIT:", safeLimit);
  console.log("📊 ROWS FROM DB:", rows);

  return {
    records: rows,
    total: rows.length,
  };
}

/* ======================================================
   EXPORT
====================================================== */
module.exports = {
  trackUser,
  getTrackingDashboard,
};
