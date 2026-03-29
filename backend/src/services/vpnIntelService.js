const { isIP } = require("node:net");

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROXYCHECK_KEY = "30aj90-u48059-006e0z-5l5468";
const DATACENTER_KEYWORDS = [
  "amazon",
  "google",
  "digitalocean",
  "microsoft",
  "azure"
];

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
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1] || 0);
    if (second >= 16 && second <= 31) return true;
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) return true;
  return false;
}

function toBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true" || value.toLowerCase() === "yes") return true;
    if (value.toLowerCase() === "false" || value.toLowerCase() === "no") return false;
  }
  return null;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getCacheTtlMs() {
  const configured = Number(process.env.VPN_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_CACHE_TTL_MS;
}

function getProxyCheckApiKey() {
  return process.env.PROXYCHECK_API_KEY || DEFAULT_PROXYCHECK_KEY;
}

async function checkProxyCheck(ip) {
  const apiKey = getProxyCheckApiKey();
  if (!apiKey) {
    return { ok: false, proxy: null, type: null };
  }

  const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}&vpn=1`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`proxycheck status ${response.status}`);
  }

  const payload = await response.json();
  const ipRecord = payload?.[ip] || payload?.[sanitizeIp(ip)] || null;
  return {
    ok: true,
    proxy: toBool(ipRecord?.proxy),
    type: typeof ipRecord?.type === "string" ? ipRecord.type : null
  };
}

async function checkIpWhois(ip) {
  const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ipwho.is status ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || payload.success === false) {
    return { ok: false, proxy: null, city: null, country: null, isp: null };
  }

  const connection = payload.connection || {};
  const latitude = toNumber(payload.latitude);
  const longitude = toNumber(payload.longitude);
  const hasCoords =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0);

  return {
    ok: true,
    proxy: toBool(payload.proxy),
    city: typeof payload.city === "string" ? payload.city : null,
    country: typeof payload.country === "string" ? payload.country : null,
    isp: typeof connection.isp === "string" ? connection.isp : null,
    latitude: hasCoords ? latitude : null,
    longitude: hasCoords ? longitude : null
  };
}

function calculateConfidence({ proxyCheckProxy, ipWhoProxy, isp }) {
  let score = 0;

  if (proxyCheckProxy === true) {
    score += 50;
  }

  if (ipWhoProxy === true) {
    score += 30;
  }

  const ispText = String(isp || "").toLowerCase();
  if (DATACENTER_KEYWORDS.some((keyword) => ispText.includes(keyword))) {
    score += 20;
  }

  return Math.min(score, 100);
}

async function detectVpn(ipAddress) {
  const normalizedIp = sanitizeIp(ipAddress);

  if (!normalizedIp || isIP(normalizedIp) === 0 || isLocalOrPrivateIp(normalizedIp)) {
    return {
      isVpn: false,
      isProxy: false,
      vpnType: null,
      isp: null,
      confidence: 0,
      sources: "skipped"
    };
  }

  const cacheKey = normalizedIp;
  const now = Date.now();
  const cached = vpnCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const [proxyCheckResult, ipWhoResult] = await Promise.allSettled([
    checkProxyCheck(normalizedIp),
    checkIpWhois(normalizedIp)
  ]);

  const proxyCheck =
    proxyCheckResult.status === "fulfilled"
      ? proxyCheckResult.value
      : { ok: false, proxy: null, type: null };
  const ipWho =
    ipWhoResult.status === "fulfilled"
      ? ipWhoResult.value
      : { ok: false, proxy: null, city: null, country: null, isp: null, latitude: null, longitude: null };

  const confidence = calculateConfidence({
    proxyCheckProxy: proxyCheck.proxy,
    ipWhoProxy: ipWho.proxy,
    isp: ipWho.isp
  });

  const value = {
    isVpn: confidence >= 60,
    isProxy: proxyCheck.proxy === true || ipWho.proxy === true,
    vpnType: proxyCheck.type || null,
    isp: ipWho.isp || null,
    city: ipWho.city || null,
    country: ipWho.country || null,
    latitude: ipWho.latitude,
    longitude: ipWho.longitude,
    confidence,
    sources: `${proxyCheck.ok ? "proxycheck" : "proxycheck-failed"}|${ipWho.ok ? "ipwho" : "ipwho-failed"}`
  };

  const bothFailed = !proxyCheck.ok && !ipWho.ok;
  vpnCache.set(cacheKey, {
    value,
    expiresAt: now + (bothFailed ? Math.min(60_000, getCacheTtlMs()) : getCacheTtlMs())
  });

  return value;
}

module.exports = {
  checkProxyCheck,
  checkIpWhois,
  detectVpn
};
