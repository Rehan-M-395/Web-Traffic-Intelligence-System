const userTrackingService = require("../services/userTrackingService");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "0.0.0.0"
  );
}

function trackingLog(label, payload) {
  const debugEnabled = process.env.TRACKING_DEBUG !== "false";
  if (debugEnabled) {
    console.log(`[tracking] ${label}`, payload);
  }
}

function validatePayload(payload) {
  const issues = [];

  if (!payload.visitorId) issues.push("visitorId missing");
  if (!payload.userAgent) issues.push("userAgent missing");
  if (!payload.platform) issues.push("platform missing");
  if (!payload.screenResolution) issues.push("screenResolution missing");
  if (!payload.timezone) issues.push("timezone missing");
  if (!payload.language) issues.push("language missing");
  if (!payload.location || typeof payload.location !== "object") issues.push("location missing");

  return {
    valid: issues.length === 0,
    issues
  };
}

async function captureUserTracking(req, res, next) {
  try {
    const payload = req.body || {};
    const ipAddress = getClientIp(req);

    trackingLog("incoming-payload", {
      visitorId: payload.visitorId,
      userAgent: payload.userAgent,
      platform: payload.platform,
      screenResolution: payload.screenResolution,
      timezone: payload.timezone,
      language: payload.language,
      location: payload.location,
      ipAddress
    });

    const validation = validatePayload(payload);
    if (!validation.valid) {
      trackingLog("incomplete-payload", {
        issues: validation.issues,
        payload
      });
    }

    if (!payload.visitorId && !payload.userAgent) {
      return res.status(400).json({
        success: false,
        message: "Fingerprint input is incomplete"
      });
    }

    const result = await userTrackingService.trackUser(payload, ipAddress);

    return res.json({
      success: true,
      duplicate: result.duplicate,
      event: result.event
    });
  } catch (error) {
    return next(error);
  }
}

async function getUserTrackingDashboard(req, res, next) {
  try {
    const limit = Number(req.query.limit) || 50;
    const range = req.query.range || "24h";
    const from = req.query.from || null;
    const to = req.query.to || null;
    const data = await userTrackingService.getTrackingDashboard({
      limit,
      range,
      from,
      to
    });
    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  captureUserTracking,
  getUserTrackingDashboard
};
