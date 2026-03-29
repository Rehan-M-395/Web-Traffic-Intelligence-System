const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", true);

const state = {
  totalRequests: 0,
  activeRequests: 0,
  peakActiveRequests: 0,
  crashedAt: null,
  byIp: new Map()
};

const PORT = process.env.UNSTABLE_PORT || 5001;
const CRASH_CONCURRENCY = Number(process.env.UNSTABLE_CRASH_CONCURRENCY || 65);
const CPU_SPIN_MS = Number(process.env.UNSTABLE_CPU_SPIN_MS || 90);

function spinCpu(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    crypto.createHash("sha256").update(String(Math.random())).digest("hex");
  }
}

function crashServer(reason) {
  if (!state.crashedAt) {
    state.crashedAt = new Date().toISOString();
    console.error(`[UNSTABLE BACKEND] Crashing intentionally: ${reason}`);
  }

  setTimeout(() => {
    process.exit(1);
  }, 100);
}

function beginRequest(ip) {
  state.totalRequests += 1;
  state.activeRequests += 1;
  state.peakActiveRequests = Math.max(state.peakActiveRequests, state.activeRequests);
  state.byIp.set(ip, (state.byIp.get(ip) || 0) + 1);

  if (state.activeRequests > CRASH_CONCURRENCY) {
    crashServer(
      `activeRequests=${state.activeRequests} exceeded CRASH_CONCURRENCY=${CRASH_CONCURRENCY}`
    );
  }
}

function endRequest() {
  state.activeRequests = Math.max(0, state.activeRequests - 1);
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    server: "unstable-demo",
    totalRequests: state.totalRequests,
    activeRequests: state.activeRequests,
    peakActiveRequests: state.peakActiveRequests,
    crashConcurrency: CRASH_CONCURRENCY,
    cpuSpinMs: CPU_SPIN_MS
  });
});

app.post("/api/visit", (req, res) => {
  const ip = req.ip;
  beginRequest(ip);
  try {
    let uid = req.cookies.uid;
    if (!uid) {
      uid = uuidv4();
      res.cookie("uid", uid, { httpOnly: true, sameSite: "lax" });
    }

    let sid = req.cookies.sid;
    if (!sid) {
      sid = uuidv4();
      res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
    }

    spinCpu(20);

    res.json({
      success: true,
      uid,
      sessionId: sid,
      unstable: true
    });
  } finally {
    endRequest();
  }
});

app.post("/api/heartbeat", (req, res) => {
  const ip = req.ip;
  beginRequest(ip);
  try {
    spinCpu(15);
    res.sendStatus(200);
  } finally {
    endRequest();
  }
});

app.post("/api/join-queue", (req, res) => {
  const ip = req.ip;
  beginRequest(ip);
  try {
    // Intentionally heavy and unprotected endpoint to demonstrate failure under load.
    spinCpu(CPU_SPIN_MS);

    res.json({
      success: true,
      userId: req.body.userId || req.cookies.uid || "anonymous",
      status: "queued",
      queuePosition: Math.max(1, state.activeRequests),
      estimatedWaitTimeSeconds: Math.ceil(state.activeRequests / 2),
      unstable: true
    });
  } finally {
    endRequest();
  }
});

app.post("/api/simulate-burst", (req, res) => {
  const ip = req.ip;
  beginRequest(ip);
  try {
    const total = Math.min(Math.max(Number(req.body.total) || 1000, 1), 5000);
    // This intentionally blocks the event loop and can trigger crash behavior quickly.
    for (let index = 0; index < total; index += 1) {
      spinCpu(2);
      if (state.activeRequests > CRASH_CONCURRENCY) {
        crashServer("burst simulation overload");
      }
    }

    res.json({
      success: true,
      totalSent: total,
      acceptedRequests: total,
      blockedRequests: 0,
      unstable: true
    });
  } finally {
    endRequest();
  }
});

app.get("/api/dashboard", (req, res) => {
  const topIps = [...state.byIp.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ip, count]) => ({ ip, count }));

  res.json({
    success: true,
    stats: {
      totalRequests: state.totalRequests,
      activeUsers: state.activeRequests,
      blockedRequests: 0,
      queueLength: state.activeRequests,
      anomaliesDetected: 0,
      avgWaitTimeSeconds: Math.ceil(state.activeRequests / 2),
      completedRequests: 0
    },
    topIps,
    warning:
      "This backend is intentionally unstable for demo. Do not use in production."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[UNSTABLE BACKEND] Running on 0.0.0.0:${PORT}`);
  console.log(
    `[UNSTABLE BACKEND] No rate limiting, no queue protections. Crash threshold=${CRASH_CONCURRENCY}, spin=${CPU_SPIN_MS}ms`
  );
});
