import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MetricCard from "./components/MetricCard";
import SimpleLineChart from "./components/SimpleLineChart";
import StatusBadge from "./components/StatusBadge";
import { fetchDashboardData } from "./services/api";

const POLL_INTERVAL_MS = 3000;

function formatInterval(obj) {
  if (!obj) {
    return "0s";
  }

  const { hours = 0, minutes = 0, seconds = 0 } = obj;

  if (hours) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const nextData = await fetchDashboardData();
        if (!active) {
          return;
        }

        setDashboard(nextData);
        setError("");
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError("Dashboard updates are temporarily unavailable.");
      }
    }

    loadDashboard();
    const interval = setInterval(loadDashboard, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!dashboard) {
    return (
      <div className="page-shell dashboard-shell">
        <div className="loading-panel glass-panel">
          <div className="skeleton-line wide" />
          <div className="skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        </div>
      </div>
    );
  }

  const { stats, chart, anomalies, analytics } = dashboard;

  return (
    <div className="page-shell dashboard-shell">
      <section className="hero-panel glass-panel">
        <div className="hero-copy">
          <span className="eyebrow">Admin traffic dashboard</span>
          <h1>Monitor queue pressure, blocked traffic, and request flow in near real time.</h1>
          <p>
            Polling refreshes the metrics every 3 seconds so operators can react to unusual demand
            before it becomes an outage.
          </p>
        </div>
        <div className="hero-actions">
          <StatusBadge label="real-time polling" tone="success" />
          <Link className="ghost-link" to="/">
            Back to client page
          </Link>
        </div>
      </section>

      {error ? <div className="feedback error">{error}</div> : null}

      <section className="card-grid">
        <MetricCard title="Total Requests" value={stats.totalRequests} caption="Tracked queue attempts" />
        <MetricCard title="Active Users" value={stats.activeUsers} caption="Visitors active in the last 5 minutes" />
        <MetricCard title="Blocked Requests" value={stats.blockedRequests} caption="Rate-limited attempts" />
        <MetricCard title="Queue Length" value={stats.queueLength} caption="Users waiting right now" />
        <MetricCard title="Anomalies Detected" value={stats.anomaliesDetected} caption="Recent burst or abuse signals" />
        <MetricCard title="Avg Wait Time" value={`${stats.avgWaitTimeSeconds}s`} caption="Estimated across queued users" />
      </section>

      <section className="dashboard-grid">
        <div className="glass-panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Traffic chart</p>
              <h2>Requests over time</h2>
            </div>
            <StatusBadge label={`${stats.completedRequests} completed`} tone="info" />
          </div>
          <SimpleLineChart data={chart} />
        </div>

        <div className="glass-panel anomaly-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Detection feed</p>
              <h2>Latest anomalies</h2>
            </div>
            <StatusBadge label={anomalies.length ? "attention needed" : "clear"} tone={anomalies.length ? "warning" : "success"} />
          </div>

          <div className="anomaly-list">
            {anomalies.length ? (
              anomalies.map((anomaly) => (
                <article className="anomaly-item" key={anomaly.id}>
                  <div className="anomaly-type">{anomaly.type}</div>
                  <p>
                    {anomaly.details.ip || "unknown source"} on {anomaly.details.route || "/"}
                  </p>
                  <span>{new Date(anomaly.createdAt).toLocaleTimeString()}</span>
                </article>
              ))
            ) : (
              <p className="empty-state">No anomalies detected in the current window.</p>
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-grid lower">
        <div className="glass-panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Visit analytics</p>
              <h2>Top pages</h2>
            </div>
            <StatusBadge label={`${analytics.users.total_users} total users`} tone="neutral" />
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Visits</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topPages.map((page) => (
                <tr key={page.path}>
                  <td>{page.path}</td>
                  <td>{page.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="glass-panel summary-panel">
          <p className="section-label">User mix</p>
          <h2>Traffic summary</h2>
          <div className="detail-row">
            <span>New users</span>
            <strong>{analytics.users.new_users}</strong>
          </div>
          <div className="detail-row">
            <span>Returning users</span>
            <strong>{analytics.users.returning_users}</strong>
          </div>
          <div className="detail-row">
            <span>Average session</span>
            <strong>{formatInterval(analytics.avgSession)}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
