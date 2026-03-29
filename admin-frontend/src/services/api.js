async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export async function fetchDashboard() {
  const response = await fetch("/api/dashboard");
  return parseJson(response);
}

export async function fetchAdminUsers() {
  const response = await fetch("/api/admin/users");
  return parseJson(response);
}

export async function fetchRequestActivity(limit = 300) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const response = await fetch(`/api/admin/request-activity?${params.toString()}`);
  return parseJson(response);
}

export async function fetchUserTrackingDashboard(limit = 80, filters = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));

  if (filters.range) {
    params.set("range", filters.range);
  }

  if (filters.from) {
    params.set("from", filters.from);
  }

  if (filters.to) {
    params.set("to", filters.to);
  }

  const response = await fetch(`/api/user-tracking/dashboard?${params.toString()}`);
  return parseJson(response);
}
