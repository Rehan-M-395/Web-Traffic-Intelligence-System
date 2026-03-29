async function getGPU() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");

    if (!gl) {
      return "unknown";
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) {
      return "hidden";
    }

    return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  } catch {
    return "blocked";
  }
}

function getOS() {
  const ua = navigator.userAgent;

  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Mac")) return "MacOS";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("like Mac")) return "iOS";

  return "Unknown";
}

function resolveApiUrl(baseUrl, path) {
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path}`;
}

export function startHeartbeat(baseUrl = "") {
  const interval = setInterval(() => {
    fetch(resolveApiUrl(baseUrl, "/api/heartbeat"), {
      method: "POST",
      credentials: "include"
    }).catch(() => {});
  }, 15000);

  return () => clearInterval(interval);
}

export default async function sendVisit(baseUrl = "") {
  const gpu = await getGPU();

  const payload = {
    path: window.location.pathname,
    browser: navigator.userAgent,
    os: getOS(),
    cpuThreads: navigator.hardwareConcurrency,
    ram: navigator.deviceMemory || "unknown",
    gpu,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };

  const response = await fetch(resolveApiUrl(baseUrl, "/api/visit"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Visit tracking failed");
  }

  return response.json();
}
