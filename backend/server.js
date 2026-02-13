const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.set("trust proxy", true);

const visitors = [];

function getClientIP(req) {
  let ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    req.ip;

  if (ip === "::1") ip = "127.0.0.1";

  return ip;
}

app.get("/api/visit", (req, res) => {
  const ip = getClientIP(req);

  const visitor = {
    ip,
    time: new Date().toLocaleString(),
  };

  visitors.push(visitor);

  res.json({
    message: "Visit recorded",
    yourIP: ip
  });
});

app.get("/api/visitors", (req, res) => {
  res.json(visitors.reverse());
});

app.listen(5000, () => console.log("Server running on port 5000"));