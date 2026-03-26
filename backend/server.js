require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const sql = require("./neon_connection"); 

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.set("trust proxy", true);

// -------- fingerprint hash ----------
const crypto = require("crypto");
function fingerprintHash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// -------- main visit route ----------
app.post("/api/visit", async (req, res) => {
  try {
    const ip = req.ip;

    // ---------- 1. USER IDENTIFICATION ----------
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

    // ---------- 2. FINGERPRINT ----------
    const fpString = `${req.body.browser}-${req.body.os}-${req.body.gpu}-${req.body.ram}-${req.body.cpuThreads}`;
    const fpHash = fingerprintHash(fpString);

    const existingUser = await sql`
      SELECT uid FROM users WHERE uid = ${uid}
    `;

    if (existingUser.length === 0) {
      await sql`
        INSERT INTO users (uid, fingerprint_hash)
        VALUES (${uid}, ${fpHash})
      `;
    } else {
      await sql`
        UPDATE users
        SET last_seen = CURRENT_TIMESTAMP,
            visit_count = visit_count + 1
        WHERE uid = ${uid}
      `;
    }

    // ---------- 3. SESSION HANDLING (COOKIE BASED) ----------
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
        VALUES (${sessionId}, ${uid}, ${ip}, ${req.body.browser})
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

    // ---------- 4. STORE VISIT ----------
    await sql`
      INSERT INTO visits (uid, session_id, path)
      VALUES (${uid}, ${sessionId}, ${req.body.path})
    `;

    // ---------- RESPONSE ----------
    res.json({
      newUser: isNewUser,
      uid,
      sessionId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/api/stats", async (req, res) => {
  try {

    // 1 online users
    const online = await sql`
      SELECT COUNT(DISTINCT uid) AS online_users
      FROM sessions
      WHERE last_activity > NOW() - INTERVAL '5 minutes'
    `;

    // 2 new vs returning
    const users = await sql`
      SELECT
        COUNT(*) FILTER (WHERE visit_count = 1) AS new_users,
        COUNT(*) FILTER (WHERE visit_count > 1) AS returning_users,
        COUNT(*) AS total_users
      FROM users
    `;

    // 3 top pages
    const pages = await sql`
      SELECT path, COUNT(*) AS visits
      FROM visits
      GROUP BY path
      ORDER BY visits DESC
      LIMIT 5
    `;

    // 4 avg session duration
    const duration = await sql`
      SELECT COALESCE(AVG(last_activity - start_time), INTERVAL '0') AS avg_session
      FROM sessions
    `;

    res.json({
      online: online[0].online_users,
      users: users[0],
      topPages: pages,
      avgSession: duration[0].avg_session
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "stats failed" });
  }
});

app.post("/api/heartbeat", async (req, res) => {
  const sid = req.cookies.sid;
  if (!sid) return res.sendStatus(204);

  await sql`
    UPDATE sessions
    SET last_activity = CURRENT_TIMESTAMP
    WHERE session_id = ${sid}
  `;

  res.sendStatus(200);
});

// ---------- analytics ----------
app.get("/api/online-users", async (req, res) => {
  const users = await sql`
    SELECT COUNT(DISTINCT uid)
    FROM sessions
    WHERE last_activity > NOW() - INTERVAL '5 minutes'
  `;
  res.json(users[0]);
});

app.listen(5000, "0.0.0.0", () => console.log("Server running on network"));