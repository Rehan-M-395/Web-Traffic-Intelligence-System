const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const sql = require("../../neon_connection");

function fingerprintHash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function buildFingerprint(body = {}) {
  return `${body.browser}-${body.os}-${body.gpu}-${body.ram}-${body.cpuThreads}`;
}

function getFingerprintHash(body = {}) {
  return fingerprintHash(buildFingerprint(body));
}

async function ensureUser(req, res) {
  let uid = req.cookies.uid;
  let isNewUser = false;

  if (!uid) {
    uid = uuidv4();
    isNewUser = true;

    res.cookie("uid", uid, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
  }

  const fpHash = getFingerprintHash(req.body);
  const inserted = await sql`
    INSERT INTO users (uid, fingerprint_hash, visit_count, last_seen)
    VALUES (${uid}, ${fpHash}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (uid) DO NOTHING
    RETURNING uid
  `;

  if (inserted.length > 0) {
    isNewUser = true;
  } else {
    await sql`
      UPDATE users
      SET last_seen = CURRENT_TIMESTAMP,
          visit_count = visit_count + 1
      WHERE uid = ${uid}
    `;
  }

  return {
    uid,
    isNewUser
  };
}

async function ensureSession(req, res, uid) {
  const ip = req.ip;
  let sessionId = req.cookies.sid;
  let validSession = [];

  if (sessionId) {
    validSession = await sql`
      SELECT session_id
      FROM sessions
      WHERE session_id = ${sessionId}
      AND last_activity > NOW() - INTERVAL '30 minutes'
    `;
  }

  if (validSession.length === 0) {
    sessionId = uuidv4();

    await sql`
      INSERT INTO sessions (session_id, uid, ip, device)
      VALUES (${sessionId}, ${uid}, ${ip}, ${req.body.browser || "unknown"})
    `;

    res.cookie("sid", sessionId, {
      httpOnly: true,
      sameSite: "lax"
    });
  } else {
    await sql`
      UPDATE sessions
      SET last_activity = CURRENT_TIMESTAMP
      WHERE session_id = ${sessionId}
    `;
  }

  return sessionId;
}

async function trackVisit(req, res) {
  const { uid, isNewUser } = await ensureUser(req, res);
  const sessionId = await ensureSession(req, res, uid);
  const fingerprintHashValue = getFingerprintHash(req.body);

  await sql`
    INSERT INTO visits (uid, session_id, path)
    VALUES (${uid}, ${sessionId}, ${req.body.path || "/"})
  `;

  return {
    newUser: isNewUser,
    uid,
    sessionId,
    fingerprintHash: fingerprintHashValue
  };
}

async function updateHeartbeat(req) {
  const sid = req.cookies.sid;

  if (!sid) {
    return false;
  }

  await sql`
    UPDATE sessions
    SET last_activity = CURRENT_TIMESTAMP
    WHERE session_id = ${sid}
  `;

  return true;
}

async function getOnlineUsersCount() {
  const users = await sql`
    SELECT COUNT(DISTINCT uid) AS count
    FROM sessions
    WHERE last_activity > NOW() - INTERVAL '5 minutes'
  `;

  return Number(users[0].count || 0);
}

async function getStats() {
  const [online, users, pages, duration] = await Promise.all([
    sql`
      SELECT COUNT(DISTINCT uid) AS online_users
      FROM sessions
      WHERE last_activity > NOW() - INTERVAL '5 minutes'
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE visit_count = 1) AS new_users,
        COUNT(*) FILTER (WHERE visit_count > 1) AS returning_users,
        COUNT(*) AS total_users
      FROM users
    `,
    sql`
      SELECT path, COUNT(*) AS visits
      FROM visits
      GROUP BY path
      ORDER BY visits DESC
      LIMIT 5
    `,
    sql`
      SELECT COALESCE(AVG(last_activity - start_time), INTERVAL '0') AS avg_session
      FROM sessions
    `
  ]);

  return {
    online: Number(online[0].online_users || 0),
    users: users[0],
    topPages: pages.map((page) => ({
      ...page,
      visits: Number(page.visits || 0)
    })),
    avgSession: duration[0].avg_session
  };
}

async function getAdminUsers(monitorUsers = []) {
  const rows = await sql`
    SELECT
      u.uid,
      u.visit_count,
      u.last_seen,
      s.session_id,
      s.ip,
      s.device,
      s.start_time,
      s.last_activity,
      (
        SELECT COUNT(*)
        FROM visits v
        WHERE v.uid = u.uid
      ) AS total_visits
    FROM users u
    LEFT JOIN LATERAL (
      SELECT session_id, ip, device, start_time, last_activity
      FROM sessions
      WHERE uid = u.uid
      ORDER BY last_activity DESC
      LIMIT 1
    ) s ON true
    ORDER BY COALESCE(s.last_activity, u.last_seen) DESC NULLS LAST
    LIMIT 100
  `;

  const monitorMap = new Map(monitorUsers.map((user) => [user.uid, user]));

  return rows.map((row) => {
    const monitor = monitorMap.get(row.uid) || {};

    return {
      uid: row.uid,
      ip: row.ip || monitor.ip || "unknown",
      device: row.device || "unknown",
      visitCount: Number(row.visit_count || 0),
      totalVisits: Number(row.total_visits || 0),
      queueStatus: monitor.queueStatus || "idle",
      queuePosition: monitor.queuePosition || 0,
      blockedRequests: monitor.blockedRequests || 0,
      requestCount: monitor.requestCount || 0,
      anomalyCount: monitor.anomalyCount || 0,
      lastSeen: row.last_seen,
      lastActivity: row.last_activity,
      sessionId: row.session_id,
      startTime: row.start_time,
      active: Boolean(row.last_activity)
    };
  });
}

module.exports = {
  trackVisit,
  updateHeartbeat,
  getOnlineUsersCount,
  getStats,
  getAdminUsers,
  getFingerprintHash
};
