const express = require("express");
const trafficController = require("../controllers/trafficController");
const analyticsController = require("../controllers/analyticsController");
const userTrackingController = require("../controllers/userTrackingController");
const { queueRateLimit } = require("../middleware/rateLimitMiddleware");

const router = express.Router();

router.post("/visit", trafficController.trackVisit);
router.post("/heartbeat", trafficController.heartbeat);
router.get("/online-users", analyticsController.getOnlineUsers);
router.get("/stats", analyticsController.getStats);
router.get("/dashboard", analyticsController.getDashboard);
router.get("/anomalies", analyticsController.getAnomalies);
router.get("/admin/users", analyticsController.getAdminUsers);
router.get("/admin/request-activity", analyticsController.getRequestActivity);
router.get("/queue-status/:userId", trafficController.getQueueStatus);
router.post("/join-queue", queueRateLimit, trafficController.joinQueue);
router.post("/simulate-burst", trafficController.simulateBurstTraffic);
router.post("/user-tracking", userTrackingController.captureUserTracking);
router.get("/user-tracking/dashboard", userTrackingController.getUserTrackingDashboard);

module.exports = router;
