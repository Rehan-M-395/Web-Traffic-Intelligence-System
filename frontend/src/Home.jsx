import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MetricCard from "./components/MetricCard";
import StatusBadge from "./components/StatusBadge";
import {
  fetchDashboardData,
  fetchQueueStatus,
  joinQueue,
  sendVisit,
  startHeartbeat
} from "./services/api";

const POLL_INTERVAL_MS = 3000;

const initialLiveStats = {
  activeUsers: 0,
  queueLength: 0,
  blockedRequests: 0,
  avgWaitTimeSeconds: 0
};

export default function Home() {
  const [userId, setUserId] = useState("");
  const [liveStats, setLiveStats] = useState(initialLiveStats);
  const [queueState, setQueueState] = useState(null);
  const [pageState, setPageState] = useState({
    loading: true,
    submitting: false,
    error: "",
    lastUpdated: ""
  });

  useEffect(() => {
    let active = true;
    const stopHeartbeat = startHeartbeat();

    async function initialize() {
      try {
        const visit = await sendVisit();
        if (!active) {
          return;
        }

        setUserId(visit.uid);
        await refreshData(visit.uid, active);
      } catch (error) {
        if (!active) {
          return;
        }

        setPageState((current) => ({
          ...current,
          loading: false,
          error: "We could not connect to the traffic service. Please try again."
        }));
      }
    }

    initialize();

    return () => {
      active = false;
      stopHeartbeat();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    let active = true;
    const interval = setInterval(() => {
      refreshData(userId, active);
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [userId]);

  async function refreshData(currentUserId, active) {
    try {
      const [dashboard, queue] = await Promise.all([
        fetchDashboardData(),
        currentUserId ? fetchQueueStatus(currentUserId).catch(() => null) : Promise.resolve(null)
      ]);

      if (!active) {
        return;
      }

      setLiveStats({
        activeUsers: dashboard.stats.activeUsers,
        queueLength: dashboard.stats.queueLength,
        blockedRequests: dashboard.stats.blockedRequests,
        avgWaitTimeSeconds: dashboard.stats.avgWaitTimeSeconds
      });
      setQueueState(queue);
      setPageState((current) => ({
        ...current,
        loading: false,
        error: "",
        lastUpdated: new Date().toLocaleTimeString()
      }));
    } catch (error) {
      if (!active) {
        return;
      }

      setPageState((current) => ({
        ...current,
        loading: false,
        error: "Live traffic data is temporarily unavailable.",
        lastUpdated: current.lastUpdated
      }));
    }
  }

  async function handleJoinQueue() {
    setPageState((current) => ({
      ...current,
      submitting: true,
      error: ""
    }));

    try {
      const response = await joinQueue(userId);
      setQueueState(response);
      setPageState((current) => ({
        ...current,
        submitting: false,
        error: "",
        lastUpdated: new Date().toLocaleTimeString()
      }));
    } catch (error) {
      setPageState((current) => ({
        ...current,
        submitting: false,
        error:
          error.message === "Too many requests"
            ? "Too many requests. Please wait a few seconds before trying again."
            : "The server could not process your request right now."
      }));
    }
  }

  const queuePosition = queueState?.queuePosition ?? "-";
  const waitTime = queueState?.estimatedWaitTimeSeconds ?? liveStats.avgWaitTimeSeconds;
  const isBusy = pageState.submitting || queueState?.status === "queued" || queueState?.status === "processing";
  const statusTone =
    queueState?.status === "completed"
      ? "success"
      : queueState?.status === "processing"
        ? "warning"
        : queueState?.status === "queued"
          ? "info"
          : "neutral";

  return (
    <div className="page-shell client-shell">
      <section className="hero-panel glass-panel">
        <div className="hero-copy">
          <span className="eyebrow">Scalable traffic control</span>
          <h1>Keep request spikes orderly without leaving users guessing.</h1>
          <p>
            This client page shows live activity, queue placement, and wait estimates so visitors
            always know what is happening.
          </p>
        </div>
        <div className="hero-actions">
          <StatusBadge
            label={queueState?.status ? queueState.status : "idle"}
            tone={statusTone}
          />
          <Link className="ghost-link" to="/dashboard">
            Open admin dashboard
          </Link>
        </div>
      </section>

      <section className="card-grid">
        <MetricCard
          title="Active Users"
          value={liveStats.activeUsers}
          caption="Users with activity in the last 5 minutes"
        />
        <MetricCard
          title="Your Queue Position"
          value={queuePosition}
          caption="Updated every few seconds while the queue is active"
        />
        <MetricCard
          title="Estimated Wait Time"
          value={`${waitTime || 0}s`}
          caption="Based on current batch processing throughput"
        />
      </section>

      <section className="client-panel-grid">
        <div className="glass-panel request-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Request access</p>
              <h2>Join the waiting room</h2>
            </div>
            <StatusBadge
              label={pageState.loading ? "syncing" : "live"}
              tone={pageState.loading ? "warning" : "success"}
            />
          </div>

          <p className="muted-copy">
            Requests are processed in small batches to keep the service responsive during spikes.
          </p>

          <button
            className="primary-button"
            disabled={isBusy || !userId}
            onClick={handleJoinQueue}
          >
            {pageState.submitting
              ? "Submitting request..."
              : queueState?.status === "processing"
                ? "Request processing..."
                : queueState?.status === "queued"
                  ? "Already in queue"
                  : "Send request"}
          </button>

          {pageState.error ? <div className="feedback error">{pageState.error}</div> : null}
          {queueState?.status === "completed" ? (
            <div className="feedback success">
              Your queued request completed successfully. You can submit another request if needed.
            </div>
          ) : null}

          <div className="detail-row">
            <span>Queue length</span>
            <strong>{liveStats.queueLength}</strong>
          </div>
          <div className="detail-row">
            <span>Blocked requests</span>
            <strong>{liveStats.blockedRequests}</strong>
          </div>
          <div className="detail-row">
            <span>Last updated</span>
            <strong>{pageState.lastUpdated || "Waiting for data"}</strong>
          </div>
        </div>

        <div className="glass-panel status-panel">
          <p className="section-label">Experience details</p>
          <h2>What users see during heavy traffic</h2>
          <div className="timeline-list">
            <div className="timeline-item">
              <span className="timeline-dot info" />
              <div>
                <strong>Queued</strong>
                <p>Users receive an immediate queue position and estimated wait time.</p>
              </div>
            </div>
            <div className="timeline-item">
              <span className="timeline-dot warning" />
              <div>
                <strong>Protected</strong>
                <p>Repeated rapid requests are rate limited before they can overload the server.</p>
              </div>
            </div>
            <div className="timeline-item">
              <span className="timeline-dot success" />
              <div>
                <strong>Resolved</strong>
                <p>Completed requests are surfaced with a clear success state and fresh polling.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
