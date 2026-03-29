const sql = require("../../neon_connection");

const ENRICH_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;
const inFlight = new Set();
const lastAttemptByIp = new Map();

function isPrivateIp(ipAddress) {
  if (!ipAddress) {
    return true;
  }

  if (ipAddress === "::1" || ipAddress === "127.0.0.1") {
    return true;
  }

  if (ipAddress.includes(":")) {
    const normalized = ipAddress.toLowerCase();
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }

  return (
    ipAddress.startsWith("10.") ||
    ipAddress.startsWith("192.168.") ||
    ipAddress.startsWith("172.16.") ||
    ipAddress.startsWith("172.17.") ||
    ipAddress.startsWith("172.18.") ||
    ipAddress.startsWith("172.19.") ||
    ipAddress.startsWith("172.2") ||
    ipAddress.startsWith("172.30.") ||
    ipAddress.startsWith("172.31.")
  );
}

function parseProviderResponse(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  if (body.success === false) {
    return null;
  }

  const connection = body.connection || {};
  return {
    countryCode: body.country_code || body.countryCode || null,
    countryName: body.country || body.country_name || null,
    regionName: body.region || body.regionName || null,
    cityName: body.city || null,
    ispName: connection.isp || body.org || body.isp || null,
    asn: connection.asn || body.asn || null
  };
}

async function fetchGeo(ipAddress) {
  const endpoint = `https://ipwho.is/${encodeURIComponent(ipAddress)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    return parseProviderResponse(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function shouldEnrichIp(ipAddress) {
  const rows = await sql`
    SELECT country_code, updated_at
    FROM ip_profiles
    WHERE ip_address = ${ipAddress}
    LIMIT 1
  `;

  if (!rows.length) {
    return true;
  }

  const row = rows[0];
  if (!row.country_code) {
    return true;
  }

  const lastUpdated = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  return Date.now() - lastUpdated > ENRICH_TTL_MS;
}

async function updateGeoProfile(ipAddress, geo) {
  if (!geo) {
    return;
  }

  await sql`
    UPDATE ip_profiles
    SET country_code = ${geo.countryCode},
        country_name = ${geo.countryName},
        region_name = ${geo.regionName},
        city_name = ${geo.cityName},
        isp_name = ${geo.ispName},
        asn = ${geo.asn},
        updated_at = NOW()
    WHERE ip_address = ${ipAddress}
  `;
}

async function scheduleIpEnrichment(ipAddress) {
  if (!ipAddress || isPrivateIp(ipAddress)) {
    return;
  }

  if (inFlight.has(ipAddress)) {
    return;
  }

  const lastAttempt = lastAttemptByIp.get(ipAddress) || 0;
  if (Date.now() - lastAttempt < FAILURE_COOLDOWN_MS) {
    return;
  }

  inFlight.add(ipAddress);
  lastAttemptByIp.set(ipAddress, Date.now());

  try {
    const needed = await shouldEnrichIp(ipAddress);
    if (!needed) {
      return;
    }

    const geo = await fetchGeo(ipAddress);
    if (!geo) {
      return;
    }

    await updateGeoProfile(ipAddress, geo);
  } catch (error) {
    console.error("IP enrichment failed", error);
  } finally {
    inFlight.delete(ipAddress);
  }
}

module.exports = {
  scheduleIpEnrichment
};
