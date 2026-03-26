import trackVisit, { startHeartbeat as beginHeartbeat } from "../Trackvisit";

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export function sendVisit() {
  return trackVisit();
}

export function startHeartbeat() {
  return beginHeartbeat();
}

export async function fetchDashboardData() {
  const response = await fetch("/api/dashboard", {
    credentials: "include"
  });

  return parseJson(response);
}

export async function joinQueue(userId) {
  const response = await fetch("/api/join-queue", {
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

export async function fetchQueueStatus(userId) {
  const response = await fetch(`/api/queue-status/${userId}`, {
    credentials: "include"
  });

  return parseJson(response);
}
