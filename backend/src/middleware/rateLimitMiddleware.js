const trafficMonitorService = require("../services/trafficMonitorService");

function queueRateLimit(req, res, next) {
  const userId = req.body.userId || req.cookies.uid || "anonymous";
  const decision = trafficMonitorService.inspectRequest({
    ip: req.ip,
    userId,
    route: req.path
  });

  if (!decision.allowed) {
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
