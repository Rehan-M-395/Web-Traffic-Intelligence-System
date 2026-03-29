const { isIP } = require("node:net");

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const vpnCache = new Map();

function sanitizeIp(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^::ffff:/, "");
}

function isLocalOrPrivateIp(ip) {
  if (!ip) {
    return true;
  }

  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") {
    return true;
  }

  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return true;
  }

  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1] || 0);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) {
    return true;
  }

  return false;
}

function readBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeApiPayload(payload) {
  return {
    isVpn: readBool(payload?.vpn),
    isProxy: readBool(payload?.proxy),
    isTor: readBool(payload?.tor),
    fraudScore: readNumber(payload?.fraud_score)
  };
}

function getCacheTtlMs() {
  const configured = Number(process.env.VPN_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_CACHE_TTL_MS;
}

function buildApiUrl(ip) {
  const template = process.env.VPN_INTEL_API_URL;
  const apiKey = process.env.VPN_INTEL_API_KEY;

  if (template && apiKey && template.includes("{ip}") && template.includes("{key}")) {
    return template
      .replaceAll("{ip}", encodeURIComponent(ip))
      .replaceAll("{key}", encodeURIComponent(apiKey));
  }

  if (apiKey) {
    return `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(ip)}`;
  }

  return null;
}

async function fetchVpnIntel(ipAddress) {
  const normalizedIp = sanitizeIp(ipAddress);

  if (!normalizedIp || isIP(normalizedIp) === 0 || isLocalOrPrivateIp(normalizedIp)) {
    return {
      isVpn: null,
      isProxy: null,
      isTor: null,
      fraudScore: null,
      source: "skipped"
    };
  }

  const cacheKey = normalizedIp;
  const cached = vpnCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const apiUrl = buildApiUrl(normalizedIp);
  if (!apiUrl) {
    const value = {
      isVpn: null,
      isProxy: null,
      isTor: null,
      fraudScore: null,
      source: "missing-config"
    };
    vpnCache.set(cacheKey, { value, expiresAt: now + getCacheTtlMs() });
    return value;
  }

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`VPN API status ${response.status}`);
    }

    const payload = await response.json();
    const value = {
      ...normalizeApiPayload(payload),
      source: "api"
    };
    vpnCache.set(cacheKey, { value, expiresAt: now + getCacheTtlMs() });
    return value;
  } catch {
    const value = {
      isVpn: null,
      isProxy: null,
      isTor: null,
      fraudScore: null,
      source: "api-failed"
    };
    vpnCache.set(cacheKey, { value, expiresAt: now + Math.min(60_000, getCacheTtlMs()) });
    return value;
  }
}

module.exports = {
  fetchVpnIntel
};
