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
    console.log(`\n🔍 [TRACKING] ${label}`);
    console.log(JSON.stringify(payload, null, 2));
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

/* ======================================================
   📌 TRACK USER
====================================================== */
async function captureUserTracking(req, res, next) {
  try {
    const payload = req.body || {};

    // 🔥 PRIORITY: use frontend IP if available
    const ipAddress =
      payload?.location?.ipAddress ||
      getClientIp(req);

      console.log("🌐 FINAL IP USED:", ipAddress);

    trackingLog("INCOMING PAYLOAD", {
      payload,
      ipAddress
    });

    const validation = validatePayload(payload);
    if (!validation.valid) {
      trackingLog("VALIDATION ISSUES", validation.issues);
    }

    if (!payload.visitorId && !payload.userAgent) {
      return res.status(400).json({
        success: false,
        message: "Fingerprint input is incomplete"
      });
    }

    const result = await userTrackingService.trackUser(payload, ipAddress);

    trackingLog("SERVICE RESULT (TRACK USER)", result);

    return res.json({
      success: true,
      duplicate: result.duplicate,
      event: result.event
    });
  } catch (error) {
    console.error("❌ TRACK USER ERROR:", error);
    return next(error);
  }
}

/* ======================================================
   📊 DASHBOARD
====================================================== */
async function getUserTrackingDashboard(req, res, next) {
  try {
    const options = {
      limit: Number(req.query.limit),
      range: req.query.range,
      from: req.query.from,
      to: req.query.to
    };

    trackingLog("DASHBOARD QUERY PARAMS", options);

    const data = await userTrackingService.getTrackingDashboard(options);

    trackingLog("DASHBOARD DATA FROM SERVICE", data);

    return res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error("❌ DASHBOARD ERROR:", error);
    return next(error);
  }
}

module.exports = {
  captureUserTracking,
  getUserTrackingDashboard
};