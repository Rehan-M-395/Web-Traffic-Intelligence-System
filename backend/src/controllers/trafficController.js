const visitService = require("../services/visitService");
const trafficMonitorService = require("../services/trafficMonitorService");

async function trackVisit(req, res, next) {
  try {
    const visitResult = await visitService.trackVisit(req, res);
    const snapshot = await trafficMonitorService.getClientSnapshot();

    res.json({
      success: true,
      ...visitResult,
      traffic: snapshot
    });
  } catch (error) {
    next(error);
  }
}

async function heartbeat(req, res, next) {
  try {
    const touched = await visitService.updateHeartbeat(req);

    if (!touched) {
      return res.sendStatus(204);
    }

    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
}

async function joinQueue(req, res, next) {
  try {
    const userId = req.body.userId || req.cookies.uid;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User not identified"
      });
    }

    const queueState = trafficMonitorService.joinQueue({
      userId,
      ip: req.ip,
      path: req.body.path || "/"
    });

    res.json({
      success: true,
      ...queueState
    });
  } catch (error) {
    next(error);
  }
}

function getQueueStatus(req, res) {
  const { userId } = req.params;
  const status = trafficMonitorService.getQueueStatus(userId);

  if (!status) {
    return res.status(404).json({
      success: false,
      message: "Queue entry not found"
    });
  }

  return res.json({
    success: true,
    ...status
  });
}

module.exports = {
  trackVisit,
  heartbeat,
  joinQueue,
  getQueueStatus
};
