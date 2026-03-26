require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const apiRoutes = require("./routes/apiRoutes");
const { startQueueProcessor } = require("./services/trafficMonitorService");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", true);

app.use("/api", apiRoutes);

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

startQueueProcessor();

module.exports = app;
