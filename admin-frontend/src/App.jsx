import { useEffect, useMemo, useState } from "react";
import {
  fetchAdminUsers,
  fetchDashboard,
  fetchRequestActivity,
  fetchUserTrackingDashboard
} from "./services/api";

const POLL_INTERVAL_MS = 3000;

function formatTime(value) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

function formatLocation(user) {
  const parts = [];
  if (user.countryName || user.countryCode) parts.push(user.countryName || user.countryCode);
  if (user.regionName) parts.push(user.regionName);
  if (user.cityName) parts.push(user.cityName);
  return parts.length ? parts.join(" / ") : "Unknown";
}

function toSafeLower(value) {
  return String(value || "").toLowerCase();
}

function isRiskyTrackingRow(row) {
  const confidence = Number(row?.vpn?.confidence);
  return (
    row?.vpn?.detected === true ||
    row?.vpn?.isProxy === true ||
    (Number.isFinite(confidence) && confidence > 70) ||
    row?.suspicious === true
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [requestRows, setRequestRows] = useState([]);
  const [trackingCurrent, setTrackingCurrent] = useState(null);
  const [trackingRows, setTrackingRows] = useState([]);
  const [trackingSummary, setTrackingSummary] = useState({
    totalRecords: 0,
    uniqueVisitors: 0,
    suspiciousRecords: 0
  });
  const [trackingRange, setTrackingRange] = useState("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [trackingQuery, setTrackingQuery] = useState("");
  const [error, setError] = useState("");

  function buildTrackingFilters() {
    if (trackingRange !== "custom") {
      return { range: trackingRange };
    }

    const filters = {};
    if (customFrom) filters.from = new Date(customFrom).toISOString();
    if (customTo) filters.to = new Date(customTo).toISOString();
    return filters;
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [dashboardData, usersData, requestData, trackingData] = await Promise.all([
          fetchDashboard(),
          fetchAdminUsers(),
          fetchRequestActivity(500),
          fetchUserTrackingDashboard(120, buildTrackingFilters())
        ]);

        if (!active) return;

        setDashboard(dashboardData);
        setUsers(usersData.users || []);
        setRequestRows(requestData.requests || []);
        setTrackingCurrent(trackingData.current || null);
        setTrackingRows(trackingData.records || []);
        setTrackingSummary(
          trackingData.summary || {
            totalRecords: 0,
            uniqueVisitors: 0,
            suspiciousRecords: 0
          }
        );
        setError("");
      } catch {
        if (active) {
          setError("Unable to load admin monitoring data.");
        }
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [trackingRange, customFrom, customTo]);

  const filteredUsers = useMemo(() => {
    const query = toSafeLower(historyQuery);
    if (!query) return users;
    return users.filter((user) => {
      return (
        toSafeLower(user.uid).includes(query) ||
        toSafeLower(user.ip).includes(query) ||
        toSafeLower(user.device).includes(query) ||
        toSafeLower(formatLocation(user)).includes(query)
      );
    });
  }, [users, historyQuery]);

  const filteredRequestRows = useMemo(() => {
    const query = toSafeLower(userQuery);
    if (!query) return requestRows;

    return requestRows.filter((row) => {
      return (
        toSafeLower(row.uid).includes(query) ||
        toSafeLower(row.ip).includes(query) ||
        toSafeLower(row.route).includes(query) ||
        toSafeLower(row.method).includes(query) ||
        toSafeLower(row.requestType).includes(query) ||
        toSafeLower(row.decision).includes(query) ||
        toSafeLower(row.device).includes(query) ||
        toSafeLower(row.location).includes(query)
      );
    });
  }, [requestRows, userQuery]);

  const uniqueTrackingRows = useMemo(() => {
    const seen = new Set();
    const unique = [];

    for (const row of trackingRows) {
      const key = row.visitorId || row.location?.ipAddress || row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    return unique;
  }, [trackingRows]);

  const filteredTrackingRows = useMemo(() => {
    const query = toSafeLower(trackingQuery);
    if (!query) return uniqueTrackingRows;
    return uniqueTrackingRows.filter((row) => {
      return (
        toSafeLower(row?.visitorId).includes(query) ||
        toSafeLower(row?.ip_address).includes(query) ||
        toSafeLower(row?.city).includes(query) ||
        toSafeLower(row?.country).includes(query) ||
        toSafeLower(row?.device?.osPlatform).includes(query) ||
        toSafeLower(row?.vpn?.detected).includes(query) ||
        toSafeLower(row?.vpn?.isProxy).includes(query) ||
        toSafeLower(row?.vpn?.confidence).includes(query) ||
        toSafeLower(row?.vpn?.type).includes(query) ||
        toSafeLower(row?.vpn?.isp).includes(query)
      );
    });
  }, [uniqueTrackingRows, trackingQuery]);

  if (!dashboard) {
    return (
      <main className="admin-page">
        <section className="panel">Loading admin dashboard...</section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Admin Dashboard</p>
          <h1>Server Monitoring Center</h1>
          <p className="subtle-copy">
            Clean operational view for traffic, user activity, tracking history, and suspicious behavior.
          </p>
        </div>
        <div className="hero-side">
          <span className="badge">Port 5174</span>
          <span className="badge live">Auto-refresh 3s</span>
        </div>
      </section>

      {error ? <section className="panel error-banner">{error}</section> : null}

      <section className="stats-grid">
        <article className="panel stat-card"><span>Total Requests</span><strong>{dashboard.stats.totalRequests}</strong></article>
        <article className="panel stat-card"><span>Active Users</span><strong>{dashboard.stats.activeUsers}</strong></article>
        <article className="panel stat-card"><span>Blocked Requests</span><strong>{dashboard.stats.blockedRequests}</strong></article>
        <article className="panel stat-card"><span>Queue Length</span><strong>{dashboard.stats.queueLength}</strong></article>
        <article className="panel stat-card"><span>Anomalies</span><strong>{dashboard.stats.anomaliesDetected}</strong></article>
        <article className="panel stat-card"><span>Completed</span><strong>{dashboard.stats.completedRequests}</strong></article>
      </section>

      <section className="content-grid">
        <section className="panel">
          <div className="section-head">
            <h2>Recent Anomalies</h2>
          </div>
          <div className="feed-list">
            {dashboard.anomalies.length ? dashboard.anomalies.map((item) => (
              <article className="feed-item" key={item.id}>
                <strong>{item.type}</strong>
                <span>{item.details.ip || "unknown source"}</span>
                <small>{formatTime(item.createdAt)}</small>
              </article>
            )) : <p className="subtle-copy">No anomalies detected.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>Top Suspicious IPs</h2>
          </div>
          <div className="feed-list">
            {dashboard.topSuspiciousIps?.length ? dashboard.topSuspiciousIps.map((ipRow) => (
              <article className="feed-item" key={ipRow.ip}>
                <strong className="mono">{ipRow.ip}</strong>
                <span>Risk {ipRow.riskScore} | Requests {ipRow.totalRequests} | Blocked {ipRow.blockedRequests}</span>
                <small>
                  {ipRow.countryName || ipRow.countryCode || "Unknown"}
                  {ipRow.regionName ? ` / ${ipRow.regionName}` : ""}
                  {ipRow.cityName ? ` / ${ipRow.cityName}` : ""}
                  {ipRow.ispName ? ` | ${ipRow.ispName}` : ""}
                </small>
              </article>
            )) : <p className="subtle-copy">Risk feed will appear as profiles accumulate.</p>}
          </div>
        </section>
      </section>

      <section className="panel tracking-panel">
        <div className="section-head filter-head">
          <h2>Tracking Window</h2>
          <div className="tracking-filter">
            <select value={trackingRange} onChange={(event) => setTrackingRange(event.target.value)}>
              <option value="1h">Last 1 hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom Range</option>
            </select>
            {trackingRange === "custom" ? (
              <>
                <input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                <input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
              </>
            ) : null}
          </div>
        </div>

        <div className="tracking-card-grid">
          <div><span>Total Tracking Records</span><strong>{trackingSummary.totalRecords}</strong></div>
          <div><span>Unique Visitors</span><strong>{trackingSummary.uniqueVisitors}</strong></div>
          <div><span>Suspicious Tracking Records</span><strong>{trackingSummary.suspiciousRecords}</strong></div>
          <div><span>Current Visitor</span><strong className="mono">{trackingCurrent?.visitorId || "N/A"}</strong></div>
          <div><span>Current IP</span><strong className="mono">{trackingCurrent?.location?.ipAddress || "N/A"}</strong></div>
          <div><span>Location Type</span><strong>{trackingCurrent?.location?.locationType === "precise" ? "Precise" : "Approximate"}</strong></div>
          <div><span>VPN</span><strong>{trackingCurrent?.vpn?.detected === true ? "Yes" : "No"}</strong></div>
          <div><span>Proxy</span><strong>{trackingCurrent?.vpn?.isProxy === true ? "Yes" : "No"}</strong></div>
          <div><span>Confidence</span><strong>{trackingCurrent?.vpn?.confidence ?? "N/A"}</strong></div>
          <div><span>VPN Type</span><strong>{trackingCurrent?.vpn?.type || "N/A"}</strong></div>
          <div><span>ISP</span><strong>{trackingCurrent?.vpn?.isp || "N/A"}</strong></div>
        </div>
      </section>

      <section className="content-grid">
        <section className="panel">
          <div className="section-head">
            <h2>Traffic by Country</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Country</th><th>Total Requests</th><th>Blocked</th></tr>
              </thead>
              <tbody>
                {(dashboard.trafficByCountry || []).map((country) => (
                  <tr key={country.countryCode}>
                    <td>{country.countryCode} - {country.countryName}</td>
                    <td>{country.totalRequests}</td>
                    <td>{country.blockedRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>User Activity (Each Request)</h2>
            <input
              className="search-input"
              placeholder="Search by user, IP, route, method, decision"
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th><th>User ID</th><th>IP</th><th>Route</th><th>Method</th><th>Type</th><th>Decision</th><th>Status</th><th>Location</th><th>Device</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequestRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatTime(row.createdAt)}</td>
                    <td className="mono">{row.uid || "anonymous"}</td>
                    <td className="mono">{row.ip}</td>
                    <td className="mono">{row.route}</td>
                    <td>{row.method}</td>
                    <td>{row.requestType}</td>
                    <td>{row.decision}</td>
                    <td>{row.statusCode ?? "-"}</td>
                    <td>{row.location}</td>
                    <td>{row.device}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>User Activity History (Unique Users)</h2>
          <input
            className="search-input"
            placeholder="Search by user, IP, device, location"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User ID</th><th>IP</th><th>Device</th><th>Status</th><th>Queue</th><th>Requests</th><th>Blocked</th><th>Anomalies</th><th>Risk</th><th>Geo</th><th>Visits</th><th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.uid}>
                  <td className="mono">{user.uid}</td>
                  <td className="mono">{user.ip}</td>
                  <td>{user.device}</td>
                  <td>{user.active ? "active" : "idle"}</td>
                  <td>{user.queueStatus} {user.queuePosition ? `(${user.queuePosition})` : ""}</td>
                  <td>{user.requestCount}</td>
                  <td>{user.blockedRequests}</td>
                  <td>{user.anomalyCount}</td>
                  <td>{user.riskScore}</td>
                  <td>{formatLocation(user)}</td>
                  <td>{user.totalVisits}</td>
                  <td>{formatTime(user.lastActivity || user.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>User Tracking History (Unique Entries)</h2>
          <input
            className="search-input"
            placeholder="Search by visitor, IP, city, country, device"
            value={trackingQuery}
            onChange={(event) => setTrackingQuery(event.target.value)}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Visitor ID</th><th>City</th><th>Country</th><th>Coordinates</th><th>IP</th><th>Location Type</th><th>VPN</th><th>Confidence</th><th>VPN Type</th><th>ISP</th><th>Device</th><th>Suspicious</th><th>Reasons</th><th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrackingRows.map((row) => (
                <tr key={row.id} className={isRiskyTrackingRow(row) ? "risky-row" : ""}>
                <td className="mono">{row.visitor_id}</td>
                <td>{row.city || "Unknown"}</td>
                <td>{row.country || "Unknown"}</td>
                <td>{row.latitude ?? "N/A"}, {row.longitude ?? "N/A"}</td>
                <td className="mono">{row.ip_address || "N/A"}</td>
                <td>{row.location_source === "precise" ? "Precise Location" : "Approximate Location (via IP)"}</td>
                <td>{row.vpn_detected ? "Yes" : "No"}</td>
                <td>{row.vpn_confidence ?? "N/A"}</td>
                <td>{row.vpn_type || "N/A"}</td>
                <td>{row.isp || "N/A"}</td>
                <td>{row.os_platform || "Unknown"}</td>
                <td>{row.suspicious ? "Yes" : "No"}</td>
                <td>{row.suspicious_reasons?.join(", ") || "-"}</td>
                <td>{formatTime(row.created_at)}</td>
              </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
