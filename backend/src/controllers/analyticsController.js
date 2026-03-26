const visitService = require("../services/visitService");
const trafficMonitorService = require("../services/trafficMonitorService");

async function getStats(req, res, next) {
  try {
    const analytics = await visitService.getStats();
    const monitor = trafficMonitorService.getMonitoringSnapshot();

    res.json({
      ...analytics,
      monitor
    });
  } catch (error) {
    next(error);
  }
}

async function getOnlineUsers(req, res, next) {
  try {
    const online = await visitService.getOnlineUsersCount();
    res.json({ count: online });
  } catch (error) {
    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const [analytics, snapshot] = await Promise.all([
      visitService.getStats(),
      trafficMonitorService.getDashboardSnapshot()
    ]);

    res.json({
      success: true,
      stats: {
        totalRequests: snapshot.totalRequests,
        activeUsers: analytics.online,
        blockedRequests: snapshot.blockedRequests,
        queueLength: snapshot.queueLength,
        anomaliesDetected: snapshot.anomaliesDetected,
        avgWaitTimeSeconds: snapshot.avgWaitTimeSeconds,
        completedRequests: snapshot.completedRequests
      },
      chart: snapshot.requestHistory,
      anomalies: snapshot.latestAnomalies,
      analytics: {
        users: analytics.users,
        topPages: analytics.topPages,
        avgSession: analytics.avgSession
      }
    });
  } catch (error) {
    next(error);
  }
}

function getAnomalies(req, res) {
  res.json({
    success: true,
    anomalies: trafficMonitorService.getAnomalies()
  });
}

module.exports = {
  getStats,
  getOnlineUsers,
  getDashboard,
  getAnomalies
};
