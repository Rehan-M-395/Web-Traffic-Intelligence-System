const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 4;
const BURST_WINDOW_MS = 1_000;
const BURST_THRESHOLD = 15;
const BATCH_SIZE = 5;
const PROCESSING_INTERVAL_MS = 1_000;
const COMPLETION_RETENTION_MS = 120_000;
const HISTORY_LIMIT = 20;

const state = {
  requestTimestampsByIp: new Map(),
  requestTimeline: [],
  queue: [],
  queueEntries: new Map(),
  anomalies: [],
  processingStarted: false,
  totals: {
    totalRequests: 0,
    blockedRequests: 0,
    completedRequests: 0
  }
};

function pruneTimestamps(timestamps, windowMs, now) {
  return timestamps.filter((timestamp) => now - timestamp <= windowMs);
}

function addAnomaly(type, details) {
  const anomaly = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    details,
    createdAt: new Date().toISOString()
  };

  state.anomalies.unshift(anomaly);
  state.anomalies = state.anomalies.slice(0, 50);
}

function touchTimeline(now) {
  const bucketTime = Math.floor(now / 1000) * 1000;
  const lastBucket = state.requestTimeline[state.requestTimeline.length - 1];

  if (lastBucket && lastBucket.timestamp === bucketTime) {
    lastBucket.count += 1;
  } else {
    state.requestTimeline.push({
      timestamp: bucketTime,
      count: 1
    });
  }

  if (state.requestTimeline.length > HISTORY_LIMIT) {
    state.requestTimeline = state.requestTimeline.slice(-HISTORY_LIMIT);
  }
}

function inspectRequest({ ip, userId, route }) {
  const now = Date.now();
  const key = ip || userId || "unknown";
  const requestTimestamps = pruneTimestamps(
    state.requestTimestampsByIp.get(key) || [],
    RATE_LIMIT_WINDOW_MS,
    now
  );

  requestTimestamps.push(now);
  state.requestTimestampsByIp.set(key, requestTimestamps);
  state.totals.totalRequests += 1;
  touchTimeline(now);

  const burstWindowCount = pruneTimestamps(requestTimestamps, BURST_WINDOW_MS, now).length;
  if (burstWindowCount >= BURST_THRESHOLD) {
    addAnomaly("burst-traffic", {
      ip: key,
      route,
      requestsPerSecond: burstWindowCount
    });
  }

  if (requestTimestamps.length > RATE_LIMIT_MAX_REQUESTS) {
    state.totals.blockedRequests += 1;
    addAnomaly("rate-limit-exceeded", {
      ip: key,
      userId,
      route,
      count: requestTimestamps.length
    });

    return { allowed: false };
  }

  return { allowed: true };
}

function calculateQueuePosition(userId) {
  const index = state.queue.findIndex((queuedId) => queuedId === userId);
  return index === -1 ? 0 : index + 1;
}

function estimateWaitTimeSeconds(position) {
  if (!position) {
    return 0;
  }

  return Math.max(1, Math.ceil(position / BATCH_SIZE));
}

function cleanupCompletedEntries() {
  const now = Date.now();

  for (const [userId, entry] of state.queueEntries.entries()) {
    if (entry.status === "completed" && now - entry.completedAtMs > COMPLETION_RETENTION_MS) {
      state.queueEntries.delete(userId);
    }
  }
}

function createQueueResponse(entry) {
  const queuePosition = entry.status === "queued" ? calculateQueuePosition(entry.userId) : 0;
  const estimatedWaitTimeSeconds =
    entry.status === "queued" ? estimateWaitTimeSeconds(queuePosition) : 0;

  return {
    userId: entry.userId,
    status: entry.status,
    queuePosition,
    estimatedWaitTimeSeconds,
    joinedAt: entry.joinedAt,
    completedAt: entry.completedAt || null
  };
}

function joinQueue({ userId, ip, path }) {
  cleanupCompletedEntries();

  const existing = state.queueEntries.get(userId);
  if (existing && existing.status !== "completed") {
    return createQueueResponse(existing);
  }

  const entry = {
    userId,
    ip,
    path,
    status: "queued",
    joinedAt: new Date().toISOString(),
    completedAt: null,
    completedAtMs: null
  };

  state.queueEntries.set(userId, entry);
  state.queue.push(userId);

  return createQueueResponse(entry);
}

function markCompleted(entry) {
  entry.status = "completed";
  entry.completedAt = new Date().toISOString();
  entry.completedAtMs = Date.now();
  state.totals.completedRequests += 1;
}

function startQueueProcessor() {
  if (state.processingStarted) {
    return;
  }

  state.processingStarted = true;

  setInterval(() => {
    cleanupCompletedEntries();

    const currentBatch = state.queue.splice(0, BATCH_SIZE);
    currentBatch.forEach((userId) => {
      const entry = state.queueEntries.get(userId);

      if (!entry || entry.status !== "queued") {
        return;
      }

      entry.status = "processing";

      setTimeout(() => {
        markCompleted(entry);
      }, 800);
    });
  }, PROCESSING_INTERVAL_MS);
}

function getQueueStatus(userId) {
  cleanupCompletedEntries();
  const entry = state.queueEntries.get(userId);

  if (!entry) {
    return null;
  }

  return createQueueResponse(entry);
}

function getAnomalies() {
  return state.anomalies;
}

function getAverageWaitTimeSeconds() {
  if (state.queue.length === 0) {
    return 0;
  }

  const totalWait = state.queue.reduce((sum, userId) => {
    const position = calculateQueuePosition(userId);
    return sum + estimateWaitTimeSeconds(position);
  }, 0);

  return Number((totalWait / state.queue.length).toFixed(1));
}

function getMonitoringSnapshot() {
  return {
    totalRequests: state.totals.totalRequests,
    blockedRequests: state.totals.blockedRequests,
    completedRequests: state.totals.completedRequests,
    queueLength: state.queue.length,
    anomaliesDetected: state.anomalies.length,
    avgWaitTimeSeconds: getAverageWaitTimeSeconds(),
    requestHistory: state.requestTimeline.map((bucket) => ({
      time: new Date(bucket.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }),
      count: bucket.count
    })),
    latestAnomalies: state.anomalies.slice(0, 5)
  };
}

async function getDashboardSnapshot() {
  return getMonitoringSnapshot();
}

async function getClientSnapshot() {
  return {
    queueLength: state.queue.length,
    avgWaitTimeSeconds: getAverageWaitTimeSeconds()
  };
}

module.exports = {
  inspectRequest,
  joinQueue,
  getQueueStatus,
  getAnomalies,
  getMonitoringSnapshot,
  getDashboardSnapshot,
  getClientSnapshot,
  startQueueProcessor
};
