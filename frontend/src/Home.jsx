import { useEffect, useState } from "react";
import {
  fetchQueueStatus,
  getBackendBaseUrl,
  getBackendTarget,
  sendSingleRequest,
  setBackendTarget,
  sendUserTracking,
  sendVisit,
  simulateBurst,
  startHeartbeat
} from "./services/api";
import {
  captureTrackingEvent,
  getStoredConsent
} from "./services/userTrackingClient";

const POLL_INTERVAL_MS = 3000;

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toLocaleString();
}

export default function Home() {
  const [userId, setUserId] = useState("");
  const [queueState, setQueueState] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backendTarget, setBackendTargetState] = useState(getBackendTarget());
  const [trackingConsent, setTrackingConsent] = useState(getStoredConsent());
  const [trackingCurrent, setTrackingCurrent] = useState(null);
  const [trackingError, setTrackingError] = useState("");

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
        const queue = await fetchQueueStatus(visit.uid).catch(() => null);
        if (active) {
          setQueueState(queue);
        }

        await captureTracking(undefined, visit.uid);
      } catch {
        if (active) {
          setError("Unable to connect to the traffic server.");
        }
      }
    }

    setUserId("");
    setQueueState(null);
    initialize();

    return () => {
      active = false;
      stopHeartbeat();
    };
  }, [backendTarget]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    let active = true;
    const interval = setInterval(async () => {
      try {
        const nextState = await fetchQueueStatus(userId).catch(() => null);
        if (active) {
          setQueueState(nextState);
        }
      } catch {
        if (active) {
          setError("Live queue updates are unavailable right now.");
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [userId, backendTarget]);

  function handleBackendSwitch(target) {
    setBackendTarget(target);
    setBackendTargetState(getBackendTarget());
    setError("");
    setMessage("");
  }

  async function handleSingleRequest() {
    setBusyAction("single");
    setError("");
    setMessage("");

    try {
      const response = await sendSingleRequest(userId);
      setQueueState(response);
      setMessage("Single request submitted successfully.");
    } catch (requestError) {
      setError(requestError.message || "Request failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleBurstRequest() {
    setBusyAction("burst");
    setError("");
    setMessage("");

    try {
      const response = await simulateBurst(userId, 1000);
      if (response.queue) {
        setQueueState(response.queue);
      }
      setMessage(
        `Burst complete: ${response.acceptedRequests} accepted, ${response.blockedRequests} blocked.`
      );
    } catch (requestError) {
      setError(requestError.message || "Burst simulation failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function captureTracking(consentOverride, uidOverride) {
    try {
      const consentState = consentOverride || trackingConsent;
      const response = await captureTrackingEvent(sendUserTracking, consentState, {
        uid: uidOverride || userId || null
      });
      if (response?.event) {
        setTrackingCurrent(response.event);
      }
      setTrackingConsent(getStoredConsent());
      setTrackingError("");
    } catch (trackingCaptureError) {
      setTrackingError(trackingCaptureError.message || "Tracking capture failed.");
    }
  }

  const queueLabel = queueState?.status || "idle";
  const queuePosition = queueState?.queuePosition ?? 0;
  const waitTime = queueState?.estimatedWaitTimeSeconds ?? 0;

  return (
    <main className="client-page">
      <section className="client-card">
        <p className="eyebrow">Client Traffic Simulator</p>
        <h1>Send one request or launch a 1000-request burst.</h1>
        <p className="subtle-copy">
          This page is intentionally simple. Use it to test normal traffic versus burst traffic
          from one client.
        </p>

        <div className="consent-banner">
          <strong>Location consent</strong>
          <p>
            We first try browser GPS. If permission is denied or fails, tracking automatically
            falls back to IP-based approximate location.
          </p>
          <small className="consent-status">
            Consent status: {trackingConsent === "granted" ? "Precise location enabled" : trackingConsent === "denied" ? "Permission denied earlier, using IP fallback" : "Pending decision"}
          </small>
        </div>

        <div className="backend-switch">
          <button
            className={`target-button ${backendTarget === "stable" ? "active" : ""}`}
            disabled={Boolean(busyAction)}
            onClick={() => handleBackendSwitch("stable")}
          >
            Use Stable Backend (5000)
          </button>
          <button
            className={`target-button ${backendTarget === "unstable" ? "active" : ""}`}
            disabled={Boolean(busyAction)}
            onClick={() => handleBackendSwitch("unstable")}
          >
            Use Unstable Backend (5001)
          </button>
        </div>

        <p className="target-hint">
          Current target: <code>{getBackendBaseUrl()}</code>
        </p>

        <div className="status-grid">
          <div className="status-tile">
            <span>Status</span>
            <strong>{queueLabel}</strong>
          </div>
          <div className="status-tile">
            <span>Queue Position</span>
            <strong>{queuePosition}</strong>
          </div>
          <div className="status-tile">
            <span>Estimated Wait</span>
            <strong>{waitTime}s</strong>
          </div>
        </div>

        <div className="action-grid">
          <button
            className="action-button"
            disabled={!userId || Boolean(busyAction)}
            onClick={handleSingleRequest}
          >
            {busyAction === "single" ? "Sending..." : "Send 1 Request"}
          </button>
          <button
            className="action-button burst"
            disabled={!userId || Boolean(busyAction)}
            onClick={handleBurstRequest}
          >
            {busyAction === "burst" ? "Bursting..." : "Send 1000 Burst Requests"}
          </button>
        </div>

        {message ? <div className="panel-message success">{message}</div> : null}
        {error ? <div className="panel-message error">{error}</div> : null}
        {trackingError ? <div className="panel-message error">{trackingError}</div> : null}

        <div className="tracking-card">
          <h2>Current User Tracking Card</h2>
          {trackingCurrent ? (
            <div className="tracking-grid">
              {(() => {
                const device = trackingCurrent.device || {};
                const location = trackingCurrent.location || {};
                return (
                  <>
                    <div><span>Visitor ID</span><strong>{trackingCurrent.visitorId}</strong></div>
                    <div><span>OS/Platform</span><strong>{device.osPlatform || "Unknown"}</strong></div>
                    <div><span>Language</span><strong>{device.language || "Unknown"}</strong></div>
                    <div><span>Screen</span><strong>{device.screenResolution || "Unknown"}</strong></div>
                    <div><span>Timezone</span><strong>{device.timezone || "Unknown"}</strong></div>
                    <div><span>Location</span><strong>{location.city || "Unknown"}, {location.country || "Unknown"}</strong></div>
                    <div><span>Location Type</span><strong>{location.locationType === "precise" ? "Precise Location" : "Approximate Location (via IP)"}</strong></div>
                    <div><span>Coordinates</span><strong>{location.latitude ?? "N/A"}, {location.longitude ?? "N/A"}</strong></div>
                    <div><span>IP</span><strong>{location.ipAddress || "N/A"}</strong></div>
                    <div><span>Timestamp</span><strong>{formatDate(trackingCurrent.timestamp)}</strong></div>
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="helper-copy">Tracking card will appear after first capture.</p>
          )}
        </div>

        <div className="helper-copy">
          Admin dashboard runs separately on <code>http://localhost:5174</code>.
        </div>
      </section>
    </main>
  );
}
