const sql = require("../../neon_connection");
const { scheduleIpEnrichment } = require("./geoEnrichmentService");

function normalizeNullableUuid(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(value) ? value : null;
}

async function upsertIpProfile({
  ipAddress,
  userId = null,
  blockedDelta = 0,
  anomalyDelta = 0,
  requestDelta = 0
}) {
  if (!ipAddress) {
    return;
  }
  const normalizedUserId = normalizeNullableUuid(userId);

  await sql`
    INSERT INTO ip_profiles (
      ip_address,
      total_requests,
      blocked_requests,
      anomaly_count,
      unique_users,
      first_seen,
      last_seen,
      created_at,
      updated_at
    )
    VALUES (
      ${ipAddress},
      ${requestDelta},
      ${blockedDelta},
      ${anomalyDelta},
      ${normalizedUserId ? 1 : 0},
      NOW(),
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (ip_address) DO UPDATE
    SET total_requests = ip_profiles.total_requests + ${requestDelta},
        blocked_requests = ip_profiles.blocked_requests + ${blockedDelta},
        anomaly_count = ip_profiles.anomaly_count + ${anomalyDelta},
        risk_score = LEAST(
          100,
          GREATEST(
            0,
            ((ip_profiles.blocked_requests + ${blockedDelta}) * 4) +
            ((ip_profiles.anomaly_count + ${anomalyDelta}) * 8) +
            LEAST((ip_profiles.total_requests + ${requestDelta}) / 15, 20)
          )::int
        ),
        unique_users = CASE
          WHEN ${normalizedUserId}::uuid IS NULL THEN ip_profiles.unique_users
          WHEN EXISTS (
            SELECT 1
            FROM request_logs
            WHERE ip_address = ${ipAddress}
              AND uid = ${normalizedUserId}::uuid
            LIMIT 1
          ) THEN ip_profiles.unique_users
          ELSE ip_profiles.unique_users + 1
        END,
        last_seen = NOW(),
        updated_at = NOW()
  `;

  safePersist("ip geo enrichment", () => scheduleIpEnrichment(ipAddress));
}

async function logRequest({
  userId = null,
  sessionId = null,
  ipAddress,
  routePath,
  method = "POST",
  requestType = "normal",
  decision = "allowed",
  statusCode = null,
  userAgent = null,
  deviceName = null,
  fingerprintHash = null,
  metadata = {}
}) {
  await sql`
    INSERT INTO request_logs (
      uid,
      session_id,
      ip_address,
      route_path,
      method,
      request_type,
      decision,
      status_code,
      user_agent,
      device_name,
      fingerprint_hash,
      metadata
    )
    VALUES (
      ${normalizeNullableUuid(userId)},
      ${normalizeNullableUuid(sessionId)},
      ${ipAddress},
      ${routePath},
      ${method},
      ${requestType},
      ${decision},
      ${statusCode},
      ${userAgent},
      ${deviceName},
      ${fingerprintHash},
      ${JSON.stringify(metadata)}
    )
  `;

  await upsertIpProfile({
    ipAddress,
    userId,
    requestDelta: 1,
    blockedDelta: decision === "blocked" ? 1 : 0
  });
}

async function createQueueEntry({
  userId = null,
  ipAddress,
  routePath,
  status,
  queuePosition,
  estimatedWaitSeconds,
  requestCount = 1,
  metadata = {}
}) {
  await sql`
    INSERT INTO queue_entries (
      uid,
      ip_address,
      route_path,
      status,
      queue_position,
      estimated_wait_seconds,
      request_count,
      metadata
    )
    VALUES (
      ${normalizeNullableUuid(userId)},
      ${ipAddress},
      ${routePath},
      ${status},
      ${queuePosition},
      ${estimatedWaitSeconds},
      ${requestCount},
      ${JSON.stringify(metadata)}
    )
  `;
}

async function updateQueueEntry({
  userId,
  status,
  queuePosition,
  estimatedWaitSeconds,
  requestCount,
  processingStarted = false,
  completed = false,
  metadata
}) {
  await sql`
    UPDATE queue_entries
    SET status = COALESCE(${status}, status),
        queue_position = COALESCE(${queuePosition}, queue_position),
        estimated_wait_seconds = COALESCE(${estimatedWaitSeconds}, estimated_wait_seconds),
        request_count = COALESCE(${requestCount}, request_count),
        processing_started_at = CASE
          WHEN ${processingStarted} THEN NOW()
          ELSE processing_started_at
        END,
        completed_at = CASE
          WHEN ${completed} THEN NOW()
          ELSE completed_at
        END,
        metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata)
    WHERE id = (
      SELECT id
      FROM queue_entries
      WHERE uid = ${normalizeNullableUuid(userId)}
        AND completed_at IS NULL
      ORDER BY joined_at DESC
      LIMIT 1
    )
  `;
}

async function logAnomaly({
  userId = null,
  ipAddress,
  anomalyType,
  severity = "medium",
  routePath = null,
  requestsPerSecond = null,
  details = {}
}) {
  await sql`
    INSERT INTO anomaly_events (
      uid,
      ip_address,
      anomaly_type,
      severity,
      route_path,
      requests_per_second,
      details
    )
    VALUES (
      ${normalizeNullableUuid(userId)},
      ${ipAddress},
      ${anomalyType},
      ${severity},
      ${routePath},
      ${requestsPerSecond},
      ${JSON.stringify(details)}
    )
  `;

  await upsertIpProfile({
    ipAddress,
    userId,
    anomalyDelta: 1
  });
}

async function safePersist(taskName, operation) {
  try {
    await operation();
  } catch (error) {
    console.error(`Persistence failed for ${taskName}`, error);
  }
}

module.exports = {
  logRequest,
  createQueueEntry,
  updateQueueEntry,
  logAnomaly,
  upsertIpProfile,
  safePersist
};
