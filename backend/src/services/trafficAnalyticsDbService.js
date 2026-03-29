const sql = require("../../neon_connection");

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function formatChartTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

async function getMonitoringSnapshot() {
  const [requestTotals, queueSnapshot, anomalyTotals, chartRows, activeUsersRow] = await Promise.all([
    sql`
      WITH profile_totals AS (
        SELECT
          COALESCE(SUM(total_requests), 0) AS profile_total_requests,
          COALESCE(SUM(blocked_requests), 0) AS profile_blocked_requests
        FROM ip_profiles
      ),
      request_totals AS (
        SELECT
          COUNT(*) AS request_total_requests,
          COUNT(*) FILTER (WHERE decision = 'blocked') AS request_blocked_requests
        FROM request_logs
      )
      SELECT
        CASE
          WHEN profile_totals.profile_total_requests > 0
            THEN profile_totals.profile_total_requests
          ELSE request_totals.request_total_requests
        END AS total_requests,
        CASE
          WHEN profile_totals.profile_total_requests > 0
            THEN profile_totals.profile_blocked_requests
          ELSE request_totals.request_blocked_requests
        END AS blocked_requests
      FROM profile_totals, request_totals
    `,
    sql`
      WITH latest_queue AS (
        SELECT DISTINCT ON (uid)
          uid,
          status,
          queue_position,
          estimated_wait_seconds,
          completed_at
        FROM queue_entries
        WHERE uid IS NOT NULL
        ORDER BY uid, joined_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued', 'processing') AND completed_at IS NULL) AS queue_length,
        COALESCE(
          AVG(estimated_wait_seconds) FILTER (WHERE status = 'queued' AND completed_at IS NULL),
          0
        ) AS avg_wait_time_seconds,
        (
          SELECT COUNT(*) FROM queue_entries WHERE completed_at IS NOT NULL
        ) AS completed_requests
      FROM latest_queue
    `,
    sql`
      SELECT COUNT(*) AS anomaly_count
      FROM anomaly_events
    `,
    sql`
      SELECT
        date_trunc('second', created_at) AS bucket_time,
        COUNT(*) AS request_count
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL '90 seconds'
      GROUP BY bucket_time
      ORDER BY bucket_time DESC
      LIMIT 20
    `,
    sql`
      SELECT
        COUNT(DISTINCT COALESCE(uid::text, ip_address)) AS active_users
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL '5 minutes'
    `
  ]);

  const chart = [...chartRows]
    .reverse()
    .map((row) => ({
      time: formatChartTime(row.bucket_time),
      count: toNumber(row.request_count)
    }));

  return {
    totalRequests: toNumber(requestTotals[0]?.total_requests),
    blockedRequests: toNumber(requestTotals[0]?.blocked_requests),
    activeUsers: toNumber(activeUsersRow[0]?.active_users),
    queueLength: toNumber(queueSnapshot[0]?.queue_length),
    avgWaitTimeSeconds: Number(toNumber(queueSnapshot[0]?.avg_wait_time_seconds).toFixed(1)),
    completedRequests: toNumber(queueSnapshot[0]?.completed_requests),
    anomaliesDetected: toNumber(anomalyTotals[0]?.anomaly_count),
    requestHistory: chart
  };
}

async function getLatestAnomalies(limit = 25) {
  const anomalies = await sql`
    SELECT
      id,
      uid,
      ip_address,
      anomaly_type,
      severity,
      route_path,
      requests_per_second,
      details,
      detected_at
    FROM anomaly_events
    ORDER BY detected_at DESC
    LIMIT ${limit}
  `;

  return anomalies.map((event) => {
    const details = asObject(event.details);
    return {
      id: String(event.id),
      type: event.anomaly_type,
      details: {
        ...details,
        ip: details.ip || event.ip_address,
        userId: details.userId || event.uid || null,
        route: details.route || event.route_path || null,
        requestsPerSecond:
          details.requestsPerSecond || toNumber(event.requests_per_second, null)
      },
      createdAt: event.detected_at,
      severity: event.severity
    };
  });
}

async function getAdminUsers(limit = 100) {
  const rows = await sql`
    WITH latest_session AS (
      SELECT DISTINCT ON (uid)
        uid,
        session_id,
        ip::text AS ip_text,
        device,
        start_time,
        last_activity
      FROM sessions
      ORDER BY uid, last_activity DESC
    ),
    latest_request_activity AS (
      SELECT
        uid,
        MAX(created_at) AS last_request_at
      FROM request_logs
      WHERE uid IS NOT NULL
      GROUP BY uid
    ),
    tracking_events_normalized AS (
      SELECT
        NULLIF(metadata->>'uid', '') AS uid_text,
        regexp_replace(COALESCE(ip_address, ''), '^::ffff:', '') AS normalized_ip,
        created_at,
        CASE
          WHEN city IS NULL OR btrim(city) = '' OR lower(btrim(city)) = 'unknown' THEN NULL
          ELSE btrim(city)
        END AS city_clean,
        CASE
          WHEN country IS NULL OR btrim(country) = '' OR lower(btrim(country)) = 'unknown' THEN NULL
          ELSE btrim(country)
        END AS country_clean
      FROM user_tracking_events
    ),
    latest_tracking_activity AS (
      SELECT
        uid_text AS uid,
        MAX(created_at) AS last_tracked_at
      FROM tracking_events_normalized
      WHERE uid_text IS NOT NULL
      GROUP BY uid_text
    ),
    latest_tracking_by_uid AS (
      SELECT DISTINCT ON (uid_text)
        uid_text AS uid,
        city_clean AS city,
        country_clean AS country,
        created_at AS tracked_at
      FROM tracking_events_normalized
      WHERE uid_text IS NOT NULL
        AND (city_clean IS NOT NULL OR country_clean IS NOT NULL)
      ORDER BY uid_text, created_at DESC
    ),
    latest_tracking_geo AS (
      SELECT DISTINCT ON (normalized_ip)
        normalized_ip,
        city_clean AS city,
        country_clean AS country
      FROM tracking_events_normalized
      WHERE normalized_ip <> ''
        AND (city_clean IS NOT NULL OR country_clean IS NOT NULL)
      ORDER BY normalized_ip, created_at DESC
    ),
    latest_tracking_activity_by_ip AS (
      SELECT
        normalized_ip,
        MAX(created_at) AS last_tracked_ip_at
      FROM tracking_events_normalized
      WHERE normalized_ip <> ''
      GROUP BY normalized_ip
    ),
    request_stats AS (
      SELECT
        uid,
        COUNT(*) AS request_count,
        COUNT(*) FILTER (WHERE decision = 'blocked') AS blocked_requests
      FROM request_logs
      WHERE uid IS NOT NULL
      GROUP BY uid
    ),
    anomaly_stats AS (
      SELECT
        uid,
        COUNT(*) AS anomaly_count
      FROM anomaly_events
      WHERE uid IS NOT NULL
      GROUP BY uid
    ),
    latest_queue AS (
      SELECT DISTINCT ON (uid)
        uid,
        status,
        queue_position
      FROM queue_entries
      WHERE uid IS NOT NULL
      ORDER BY uid, joined_at DESC
    ),
    latest_request_ip AS (
      SELECT DISTINCT ON (uid)
        uid,
        ip_address
      FROM request_logs
      WHERE uid IS NOT NULL
      ORDER BY uid, created_at DESC
    ),
    visit_totals AS (
      SELECT
        uid,
        COUNT(*) AS total_visits
      FROM visits
      GROUP BY uid
    )
    SELECT
      u.uid,
      u.visit_count,
      u.last_seen,
      ls.session_id,
      COALESCE(ls.ip_text, lri.ip_address, 'unknown') AS ip,
      COALESCE(ls.device, 'unknown') AS device,
      ls.start_time,
      GREATEST(
        COALESCE(ls.last_activity, to_timestamp(0)),
        COALESCE(lra.last_request_at, to_timestamp(0)),
        COALESCE(lta.last_tracked_at, to_timestamp(0)),
        COALESCE(ltip.last_tracked_ip_at, to_timestamp(0)),
        COALESCE(ltu.tracked_at, to_timestamp(0)),
        COALESCE(u.last_seen, to_timestamp(0))
      ) AS effective_last_activity,
      COALESCE(vt.total_visits, 0) AS total_visits,
      COALESCE(rs.request_count, 0) AS request_count,
      COALESCE(rs.blocked_requests, 0) AS blocked_requests,
      COALESCE(ans.anomaly_count, 0) AS anomaly_count,
      COALESCE(lq.status, 'idle') AS queue_status,
      COALESCE(lq.queue_position, 0) AS queue_position,
      COALESCE(ipf.country_code, NULL) AS country_code,
      COALESCE(ipf.country_name, ltu.country, ltg.country, NULL) AS country_name,
      COALESCE(ipf.region_name, NULL) AS region_name,
      COALESCE(ipf.city_name, ltu.city, ltg.city, NULL) AS city_name,
      COALESCE(ipf.risk_score, 0) AS risk_score
    FROM users u
    LEFT JOIN latest_session ls ON ls.uid = u.uid
    LEFT JOIN latest_request_ip lri ON lri.uid = u.uid
    LEFT JOIN latest_request_activity lra ON lra.uid = u.uid
    LEFT JOIN latest_tracking_activity lta ON lta.uid = u.uid::text
    LEFT JOIN latest_tracking_by_uid ltu ON ltu.uid = u.uid::text
    LEFT JOIN request_stats rs ON rs.uid = u.uid
    LEFT JOIN anomaly_stats ans ON ans.uid = u.uid
    LEFT JOIN latest_queue lq ON lq.uid = u.uid
    LEFT JOIN visit_totals vt ON vt.uid = u.uid
    LEFT JOIN ip_profiles ipf ON ipf.ip_address = COALESCE(ls.ip_text, lri.ip_address)
    LEFT JOIN latest_tracking_geo ltg
      ON ltg.normalized_ip = regexp_replace(COALESCE(ls.ip_text, lri.ip_address, ''), '^::ffff:', '')
    LEFT JOIN latest_tracking_activity_by_ip ltip
      ON ltip.normalized_ip = regexp_replace(COALESCE(ls.ip_text, lri.ip_address, ''), '^::ffff:', '')
    ORDER BY effective_last_activity DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    uid: row.uid,
    ip: row.ip || "unknown",
    device: row.device || "unknown",
    visitCount: toNumber(row.visit_count),
    totalVisits: toNumber(row.total_visits),
    queueStatus: row.queue_status || "idle",
    queuePosition: toNumber(row.queue_position),
    blockedRequests: toNumber(row.blocked_requests),
    requestCount: toNumber(row.request_count),
    anomalyCount: toNumber(row.anomaly_count),
    riskScore: toNumber(row.risk_score),
    countryCode: row.country_code,
    countryName: row.country_name,
    regionName: row.region_name,
    cityName: row.city_name,
    lastSeen: row.last_seen,
    lastActivity: row.effective_last_activity,
    sessionId: row.session_id,
    startTime: row.start_time,
    active:
      Boolean(row.effective_last_activity) &&
      new Date(row.effective_last_activity).getTime() > Date.now() - 5 * 60 * 1000
  }));
}

async function getRequestActivity(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const rows = await sql`
    SELECT
      rl.id,
      rl.uid,
      rl.session_id,
      rl.ip_address,
      rl.route_path,
      rl.method,
      rl.request_type,
      rl.decision,
      rl.status_code,
      rl.user_agent,
      rl.device_name,
      rl.created_at,
      COALESCE(
        NULLIF(ipf.country_name, ''),
        NULLIF(ipf.country_code, ''),
        NULL
      ) AS country_name,
      NULLIF(ipf.region_name, '') AS region_name,
      NULLIF(ipf.city_name, '') AS city_name
    FROM request_logs rl
    LEFT JOIN ip_profiles ipf ON ipf.ip_address = rl.ip_address
    ORDER BY rl.created_at DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: String(row.id),
    uid: row.uid || null,
    sessionId: row.session_id || null,
    ip: row.ip_address || "unknown",
    route: row.route_path || "/",
    method: row.method || "GET",
    requestType: row.request_type || "normal",
    decision: row.decision || "allowed",
    statusCode: toNumber(row.status_code, null),
    device: row.device_name || row.user_agent || "unknown",
    location: [row.country_name, row.region_name, row.city_name].filter(Boolean).join(" / ") || "Unknown",
    createdAt: row.created_at
  }));
}

async function getIpRiskInsights() {
  const [topSuspiciousRows, byCountryRows] = await Promise.all([
    sql`
      SELECT
        ip_address,
        risk_score,
        total_requests,
        blocked_requests,
        anomaly_count,
        country_code,
        country_name,
        region_name,
        city_name,
        isp_name
      FROM ip_profiles
      ORDER BY risk_score DESC, anomaly_count DESC, blocked_requests DESC
      LIMIT 8
    `,
    sql`
      SELECT
        COALESCE(country_code, 'UNK') AS country_code,
        COALESCE(country_name, 'Unknown') AS country_name,
        SUM(total_requests) AS total_requests,
        SUM(blocked_requests) AS blocked_requests
      FROM ip_profiles
      GROUP BY COALESCE(country_code, 'UNK'), COALESCE(country_name, 'Unknown')
      ORDER BY SUM(total_requests) DESC
      LIMIT 8
    `
  ]);

  const topSuspiciousIps = topSuspiciousRows.map((row) => ({
    ip: row.ip_address,
    riskScore: toNumber(row.risk_score),
    totalRequests: toNumber(row.total_requests),
    blockedRequests: toNumber(row.blocked_requests),
    anomalyCount: toNumber(row.anomaly_count),
    countryCode: row.country_code,
    countryName: row.country_name,
    regionName: row.region_name,
    cityName: row.city_name,
    ispName: row.isp_name
  }));

  const trafficByCountry = byCountryRows.map((row) => ({
    countryCode: row.country_code,
    countryName: row.country_name,
    totalRequests: toNumber(row.total_requests),
    blockedRequests: toNumber(row.blocked_requests)
  }));

  return {
    topSuspiciousIps,
    trafficByCountry
  };
}

module.exports = {
  getMonitoringSnapshot,
  getLatestAnomalies,
  getAdminUsers,
  getRequestActivity,
  getIpRiskInsights
};
