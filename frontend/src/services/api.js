import trackVisit, { startHeartbeat as beginHeartbeat } from "../Trackvisit";

const STORAGE_KEY = "traffic_backend_target";
const BACKEND_TARGETS = {
  stable: 5000,
  unstable: 5001
};

function getBrowserHost() {
  if (typeof window === "undefined") {
    return "localhost";
  }

  return window.location.hostname || "localhost";
}

function readStoredTarget() {
  if (typeof window === "undefined") {
    return "stable";
  }

  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "unstable" ? "unstable" : "stable";
}

let currentTarget = readStoredTarget();

export function getBackendTarget() {
  return currentTarget;
}

export function setBackendTarget(target) {
  currentTarget = target === "unstable" ? "unstable" : "stable";

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, currentTarget);
  }
}

export function getBackendBaseUrl() {
  const port = BACKEND_TARGETS[currentTarget] || BACKEND_TARGETS.stable;
  return `http://${getBrowserHost()}:${port}`;
}

function getStableBackendBaseUrl() {
  return `http://${getBrowserHost()}:${BACKEND_TARGETS.stable}`;
}

function buildApiUrl(path) {
  return `${getBackendBaseUrl()}${path}`;
}

function buildStableApiUrl(path) {
  return `${getStableBackendBaseUrl()}${path}`;
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export function sendVisit() {
  return trackVisit(getBackendBaseUrl());
}

export function startHeartbeat() {
  return beginHeartbeat(getBackendBaseUrl());
}

export async function sendSingleRequest(userId) {
  const response = await fetch(buildApiUrl("/api/join-queue"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId,
      path: window.location.pathname
    })
  });

  return parseJson(response);
}

export async function simulateBurst(userId, total = 1000) {
  const response = await fetch(buildApiUrl("/api/simulate-burst"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId,
      total,
      path: window.location.pathname
    })
  });

  return parseJson(response);
}

export async function fetchQueueStatus(userId) {
  const response = await fetch(buildApiUrl(`/api/queue-status/${userId}`), {
    credentials: "include"
  });

  return parseJson(response);
}

export async function sendUserTracking(payload) {
  const response = await fetch(buildStableApiUrl("/api/user-tracking"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function fetchUserTrackingDashboard(limit = 50) {
  const response = await fetch(buildApiUrl(`/api/user-tracking/dashboard?limit=${limit}`), {
    credentials: "include"
  });

  return parseJson(response);
}
