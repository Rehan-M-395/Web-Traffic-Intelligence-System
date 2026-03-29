const CONSENT_KEY = "tracking_location_consent";
const VISITOR_ID_KEY = "tracking_visitor_id";

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function getOsPlatform() {
  const ua = navigator.userAgent || "";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS")) return "MacOS";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return navigator.platform || "Unknown";
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hash);
}

async function buildFingerprint() {
  const screenWidth = Number(window.screen?.width) || 0;
  const screenHeight = Number(window.screen?.height) || 0;
  const screenResolution =
    screenWidth > 0 && screenHeight > 0 ? `${screenWidth}x${screenHeight}` : null;

  const device = {
    userAgent: normalizeString(navigator.userAgent),
    osPlatform: normalizeString(getOsPlatform()),
    platform: normalizeString(navigator.platform),
    screenResolution,
    timezone: normalizeString(Intl.DateTimeFormat().resolvedOptions().timeZone),
    language: normalizeString(navigator.language)
  };

  const fingerprintSeedParts = [
    device.userAgent,
    device.osPlatform,
    device.platform,
    device.screenResolution,
    device.timezone,
    device.language
  ].filter(Boolean);

  // Prevent hashing a fake "unknown|unknown..." payload.
  const fingerprintSeed =
    fingerprintSeedParts.length > 0
      ? fingerprintSeedParts.join("|")
      : `${Date.now()}|${Math.random()}`;

  const fingerprintHash = await sha256(fingerprintSeed);
  let visitorId = safeLocalStorageGet(VISITOR_ID_KEY);

  if (!visitorId) {
    visitorId = fingerprintHash.slice(0, 20);
    safeLocalStorageSet(VISITOR_ID_KEY, visitorId);
  }

  return {
    visitorId,
    fingerprintHash,
    device
  };
}

function getStoredConsent() {
  const value = safeLocalStorageGet(CONSENT_KEY);
  return value === "granted" || value === "denied" ? value : "pending";
}

function setStoredConsent(value) {
  if (value === "granted" || value === "denied") {
    safeLocalStorageSet(CONSENT_KEY, value);
  }
}

function getPreciseLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not available"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

async function getIpBasedLocation() {
  try {
    const response = await fetch("https://ipwho.is/");
    if (!response.ok) {
      return null;
    }

    const body = await response.json();
    if (!body || body.success === false) {
      return null;
    }

    return {
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
      city: normalizeString(body.city),
      country: normalizeString(body.country),
      ipAddress: normalizeString(body.ip),
      locationType: "approximate"
    };
  } catch {
    return null;
  }
}

async function captureTrackingEvent(sendFn, consentState, context = {}) {
  const fingerprint = await buildFingerprint();
  const ipLocation = await getIpBasedLocation();
  let location = {
    locationType: "approximate"
  };
  let preciseLocationAllowed = false;

  // Do not ask repeatedly: if user denied once, always fallback to IP in future attempts.
  if (consentState !== "denied") {
    try {
      const precise = await getPreciseLocation();
      location = {
        ...precise,
        city: ipLocation?.city || null,
        country: ipLocation?.country || null,
        ipAddress: ipLocation?.ipAddress || null,
        locationType: "precise"
      };
      preciseLocationAllowed = true;
      setStoredConsent("granted");
    } catch {
      if (consentState === "pending") {
        setStoredConsent("denied");
      }
      location = ipLocation || { locationType: "approximate" };
    }
  } else {
    location = ipLocation || { locationType: "approximate" };
  }

  // Ensure frontend never sends an empty location object.
  if (!location.city && !location.country && location.latitude == null && location.longitude == null) {
    location = {
      ...location,
      city: "Unknown",
      country: "Unknown",
      locationType: "approximate"
    };
  }

  const payload = {
    visitorId: fingerprint.visitorId,
    fingerprintHash: fingerprint.fingerprintHash,
    uid: context.uid || null,
    userAgent: fingerprint.device.userAgent,
    platform: fingerprint.device.platform,
    osPlatform: fingerprint.device.osPlatform,
    screenResolution: fingerprint.device.screenResolution,
    timezone: fingerprint.device.timezone,
    language: fingerprint.device.language,
    preciseLocationAllowed,
    location
  };

  return sendFn(payload);
}

export {
  getStoredConsent,
  setStoredConsent,
  captureTrackingEvent
};
