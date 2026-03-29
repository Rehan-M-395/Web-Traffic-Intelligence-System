const trafficMonitorService = require("../services/trafficMonitorService");
const { logRequest, safePersist } = require("../services/trafficPersistenceService");

function queueRateLimit(req, res, next) {
  const userId = req.body.userId || req.cookies.uid || "anonymous";
  const decision = trafficMonitorService.inspectRequest({
    ip: req.ip,
    userId,
    route: req.path
  });

  if (!decision.allowed) {
    safePersist("rate-limited request log", () =>
      logRequest({
        userId: userId === "anonymous" ? null : userId,
        sessionId: req.cookies.sid || null,
        ipAddress: req.ip,
        routePath: req.path,
        method: req.method,
        requestType: "queue-join",
        decision: "blocked",
        statusCode: 429,
        userAgent: req.get("user-agent") || null,
        metadata: {
          reason: "rate-limit"
        }
      })
    );
    return res.status(429).json({
      success: false,
      message: "Too many requests"
    });
  }

  return next();
}

module.exports = {
  queueRateLimit
};
