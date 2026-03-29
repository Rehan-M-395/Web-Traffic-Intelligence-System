const visitService = require("../services/visitService");
const trafficMonitorService = require("../services/trafficMonitorService");
const trafficAnalyticsDbService = require("../services/trafficAnalyticsDbService");

async function getMonitoringSnapshotWithFallback() {
  try {
    return await trafficAnalyticsDbService.getMonitoringSnapshot();
  } catch (error) {
    console.error("DB monitoring snapshot failed, using in-memory fallback", error);
    return trafficMonitorService.getMonitoringSnapshot();
  }
}

async function getLatestAnomaliesWithFallback(limit = 25) {
  try {
    return await trafficAnalyticsDbService.getLatestAnomalies(limit);
  } catch (error) {
    console.error("DB anomaly read failed, using in-memory fallback", error);
    return trafficMonitorService.getAnomalies().slice(0, limit);
  }
}

async function getAdminUsersWithFallback(limit = 100) {
  try {
    return await trafficAnalyticsDbService.getAdminUsers(limit);
  } catch (error) {
    console.error("DB admin users read failed, using in-memory fallback", error);
    return visitService.getAdminUsers(trafficMonitorService.getUserTrafficDetails());
  }
}

async function getStats(req, res, next) {
  try {
    const analytics = await visitService.getStats();
    const monitor = await getMonitoringSnapshotWithFallback();

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
    const [analytics, snapshot, users, latestAnomalies, ipRiskInsights] = await Promise.all([
      visitService.getStats(),
      getMonitoringSnapshotWithFallback(),
      getAdminUsersWithFallback(100),
      getLatestAnomaliesWithFallback(5),
      trafficAnalyticsDbService.getIpRiskInsights().catch(() => ({
        topSuspiciousIps: [],
        trafficByCountry: []
      }))
    ]);

    res.json({
      success: true,
      stats: {
        totalRequests: snapshot.totalRequests,
        activeUsers: snapshot.activeUsers || analytics.online,
        blockedRequests: snapshot.blockedRequests,
        queueLength: snapshot.queueLength,
        anomaliesDetected: snapshot.anomaliesDetected,
        avgWaitTimeSeconds: snapshot.avgWaitTimeSeconds,
        completedRequests: snapshot.completedRequests
      },
      chart: snapshot.requestHistory,
      anomalies: latestAnomalies,
      topSuspiciousIps: ipRiskInsights.topSuspiciousIps,
      trafficByCountry: ipRiskInsights.trafficByCountry,
      users,
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

async function getAnomalies(req, res, next) {
  try {
    const anomalies = await getLatestAnomaliesWithFallback(100);

    res.json({
      success: true,
      anomalies
    });
  } catch (error) {
    next(error);
  }
}

async function getAdminUsers(req, res, next) {
  try {
    const users = await getAdminUsersWithFallback(100);

    res.json({
      success: true,
      users
    });
  } catch (error) {
    next(error);
  }
}

async function getRequestActivity(req, res, next) {
  try {
    const limit = Number(req.query.limit) || 300;
    const rows = await trafficAnalyticsDbService.getRequestActivity(limit);

    res.json({
      success: true,
      requests: rows
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStats,
  getOnlineUsers,
  getDashboard,
  getAnomalies,
  getAdminUsers,
  getRequestActivity
};
