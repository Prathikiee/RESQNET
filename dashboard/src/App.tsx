
import { useEffect, useState } from "react";
import "./App.css";
import { dashboardDataSource } from "./data/dashboardDataSource";
import type {
  AlertPriority,
  DashboardData,
} from "./types/dashboard";

function App() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<DashboardData["alerts"]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertPriority | "All">("All");
  const [dismissedAlertMessage, setDismissedAlertMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    dashboardDataSource.getDashboardData().then(
      (data) => {
        if (!cancelled) {
          setDashboardData(data);
          setAlerts(data.alerts);
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load dashboard data.",
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleAlerts =
    filter === "All"
      ? alerts
      : alerts.filter((alert) => alert.priority === filter);
  const securityFeedStatusLabels = {
    connected: "Feed connected",
    "not-connected": "Feed not connected",
    unknown: "Feed status unknown",
  };
  const securityFeedStatus = dashboardData
    ? securityFeedStatusLabels[dashboardData.securityFeedStatus]
    : loadError
      ? "Feed unavailable"
      : "Checking feed";
  const securityEmptyState = loadError
    ? {
        variant: "error",
        icon: "!",
        title: "Security event data unavailable",
        detail: "Dashboard data could not be loaded. Security events are unavailable.",
      }
    : !dashboardData
      ? {
          variant: "loading",
          icon: "…",
          title: "Checking security feed",
          detail: "Waiting for the dashboard data source; event availability is not yet known.",
        }
      : dashboardData.securityFeedStatus === "connected"
        ? {
            variant: "connected",
            icon: "✓",
            title: "Security feed connected; no events reported",
            detail: "No security events were reported by the connected feed.",
          }
        : dashboardData.securityFeedStatus === "not-connected"
          ? {
              variant: dashboardData.source === "demo" ? "demo" : "not-connected",
              icon: "!",
              title: dashboardData.source === "demo"
                ? "Demo data; no live security feed connected"
                : "Security feed not connected",
              detail: dashboardData.source === "demo"
                ? "This demo contains no security events and has no live feed."
                : "No security events are available while the feed is not connected.",
            }
          : {
              variant: "unknown",
              icon: "?",
              title: "Security feed status unknown",
              detail: "The feed status is unknown; event availability cannot be confirmed.",
            };
  const securityBadgeState = loadError
    ? "error"
    : dashboardData
      ? dashboardData.securityFeedStatus
      : "loading";
  const securityAnnouncement = dashboardData
    ? `${dashboardData.source === "demo" ? "Demo data. " : ""}${securityFeedStatus}. ${
        dashboardData.securityEvents.length
          ? `${dashboardData.securityEvents.length} security event${dashboardData.securityEvents.length === 1 ? "" : "s"} supplied.`
          : securityEmptyState.title
      }`
    : loadError
      ? "Feed unavailable. Security event data unavailable."
      : "Checking feed. Security event status is loading.";

  function dismissDemoAlert(id: string, type: string) {
    setAlerts((current) =>
      current.filter((alert) => alert.id !== id),
    );
    setDismissedAlertMessage(
      `Demo alert ${id} (${type}) was dismissed from this temporary view.`,
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <h1>RESQNET</h1>
            <span>EMERGENCY NETWORK</span>
          </div>
        </div>

        <div className="sidebar-label">COMMAND CENTER</div>

        <nav className="navigation">
          <a className="nav-link active" href="#overview">▦ Overview</a>
          <a className="nav-link" href="#alerts">⚠ SOS Alerts</a>
          <a className="nav-link" href="#nodes">◉ Network Nodes</a>
          <a className="nav-link" href="#map">⌖ Incident Map</a>
          <a className="nav-link" href="#security">⬡ Security Events</a>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot green" />
          <div>
            <strong>Local dashboard</strong>
            <small>
              {dashboardData?.source === "demo"
                ? "Demo mode · Not connected"
                : "Dashboard data source"}
            </small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">RESQNET / OPERATIONS</span>
            <h2>Emergency Command Center</h2>
          </div>
          <div className="system-status">
            <span className="status-dot green" />
            UI running locally
          </div>
        </header>

        <section className="welcome" id="overview">
          <div>
            <span className="eyebrow light">OFFLINE EMERGENCY RESPONSE</span>
            <h2>Every alert matters.</h2>
            <p>
              Monitor SOS reports, network readiness and security events
              from one command center.
            </p>
          </div>
          <div className="welcome-symbol" aria-hidden="true">⌁</div>
        </section>

        <section className="metrics-grid" aria-label="Dashboard summary">
          <article className="metric-card">
            <span className="metric-label">SOS ALERTS</span>
            <strong>{alerts.length.toString().padStart(2, "0")}</strong>
            <span className="metric-note">
              {dashboardData?.source === "demo"
                ? "Sample dashboard records"
                : "Alert records supplied"}
            </span>
          </article>

          <article className="metric-card">
            <span className="metric-label">NETWORK NODES</span>
            <strong>{dashboardData?.networkNodes.length || "—"}</strong>
            <span className="metric-note">
              {dashboardData?.networkNodes.length
                ? "Node records supplied"
                : "Awaiting real node data"}
            </span>
          </article>

          <article
            className="metric-card gateway-card"
            aria-labelledby="gateway-status-label"
          >
            <span className="metric-label" id="gateway-status-label">
              GATEWAY STATUS
            </span>
            <strong
              className={`gateway-state gateway-state--${dashboardData?.gatewayStatus?.connectionState
                .toLowerCase()
                .replace(" ", "-") ?? "empty"}`}
            >
              <span className="gateway-state-dot" aria-hidden="true" />
              {dashboardData?.gatewayStatus?.connectionState ?? "—"}
            </strong>
            <span className="metric-note gateway-detail">
              {dashboardData?.gatewayStatus?.detail ?? "Awaiting gateway data"}
            </span>
          </article>

          <article className="metric-card">
            <span className="metric-label">SECURITY EVENTS</span>
            <strong>{dashboardData?.securityEvents.length ?? "—"}</strong>
            <span className="metric-note">
              {dashboardData?.securityEvents.length
                ? "Security event records supplied"
                : "Awaiting security event data"}
            </span>
          </article>
        </section>

        <section
          className="panel nodes-panel"
          id="nodes"
          aria-labelledby="nodes-title"
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">NETWORK OVERVIEW</span>
              <h3 id="nodes-title">Network nodes</h3>
              <p className="nodes-intro">
                Node records supplied by the RESQNET data source.
              </p>
            </div>
          </div>

          {dashboardData ? (
            dashboardData.networkNodes.length > 0 ? (
              <ul className="nodes-list" aria-label="Network nodes">
                {dashboardData.networkNodes.map((node) => (
                  <li className="node-card" key={node.id}>
                    <h4>{node.name}</h4>
                    <div className="node-card-details">
                      <div className="node-id">
                        <span className="node-field-label">Node ID</span>
                        <span className="node-field-value">{node.id}</span>
                      </div>
                      <div className="node-status-row">
                        <span className="node-field-label">Status</span>
                        <span
                          className={`node-status ${node.status.toLowerCase()}`}
                        >
                          {node.status}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="nodes-empty">
                <strong>No network nodes available</strong>
                <p>
                  Node records will appear here when supplied by the RESQNET
                  data source.
                </p>
              </div>
            )
          ) : (
            <div className="nodes-empty">
              <strong>
                {loadError
                  ? "Network node data unavailable"
                  : "Loading network node data…"}
              </strong>
            </div>
          )}
          {!dashboardData && (
            <p className="visually-hidden" role="status" aria-atomic="true">
              {loadError
                ? "Network node data unavailable"
                : "Loading network node data…"}
            </p>
          )}
        </section>

        <section className="content-grid">
          <article
            className="panel alerts-panel"
            id="alerts"
            aria-labelledby="alerts-title"
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">INCIDENT MANAGEMENT</span>
                <h3 id="alerts-title">Incoming SOS alerts</h3>
              </div>
              {dashboardData?.source === "demo" && (
                <span className="demo-badge">DEMO DATA</span>
              )}
            </div>

            <div className="filter-row">
              <label htmlFor="priority-filter">Filter by priority</label>
              <select
                id="priority-filter"
                value={filter}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilter(
                    value === "Critical" ||
                      value === "High" ||
                      value === "Medium"
                      ? value
                      : "All",
                  );
                }}
              >
                <option value="All">All priorities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
              </select>
            </div>

            <ul className="alert-list">
              {visibleAlerts.map((alert) => (
                <li className="alert-row" key={alert.id}>
                  <span className="alert-marker" aria-hidden="true">!</span>
                  <div className="alert-details">
                    <strong>{alert.type}</strong>
                    <div className="alert-metadata">
                      <span className="alert-id">{alert.id}</span>
                      <span className="alert-location">{alert.location}</span>
                    </div>
                    <span className="alert-time">{alert.time}</span>
                  </div>
                  <div className="alert-actions">
                    <span className={`priority ${alert.priority.toLowerCase()}`}>
                      {alert.priority}
                    </span>
                    {alert.verificationStatus && (
                      <span
                        className={`verification ${alert.verificationStatus.toLowerCase()}`}
                      >
                        {alert.verificationStatus}
                      </span>
                    )}
                    {dashboardData?.source === "demo" && (
                      <button
                        className="acknowledge-button"
                        aria-label={`Dismiss demo alert ${alert.id}: ${alert.type}`}
                        onClick={() => dismissDemoAlert(alert.id, alert.type)}
                      >
                        Dismiss demo
                      </button>
                    )}
                  </div>
                </li>
              ))}

              {loadError && <li className="empty-state">{loadError}</li>}
              {!dashboardData && !loadError && (
                <li className="empty-state">Loading dashboard data…</li>
              )}
              {dashboardData && visibleAlerts.length === 0 && (
                <li className="empty-state">No alerts match this filter.</li>
              )}
            </ul>

            <p className="visually-hidden" role="status" aria-atomic="true">
              {dismissedAlertMessage}
            </p>

            {dashboardData?.source === "demo" && (
              <p className="demo-notice">
                These are illustrative records, not real emergency reports.
                Dismissing one only changes this temporary screen.
              </p>
            )}
          </article>

          <article
            className="panel map-panel"
            id="map"
            aria-labelledby="map-title"
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">GEOGRAPHIC OVERVIEW</span>
                <h3 id="map-title">Incident map</h3>
              </div>
            </div>
            <div className="map-placeholder">
              <span className="map-cross" aria-hidden="true">⌖</span>
              <strong>Map integration pending</strong>
              <p>
                This map area is a placeholder. Real incident locations are
                not currently available.
              </p>
              <span className="map-caption">NO LIVE LOCATIONS</span>
            </div>
          </article>
        </section>

        <section
          className="panel security-panel"
          id="security"
          aria-labelledby="security-title"
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">TRUST & VERIFICATION</span>
              <h3 id="security-title">Security event monitoring</h3>
            </div>
            <span
              className={`waiting-badge security-status-badge security-status-badge--${securityBadgeState}`}
            >
              {dashboardData?.source === "demo"
                ? `Demo data · ${securityFeedStatus}`
                : securityFeedStatus}
            </span>
          </div>

          {dashboardData?.securityEvents.length ? (
            <ul className="security-event-list">
              {dashboardData.securityEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.description}</strong>
                  <time>{event.time}</time>
                </li>
              ))}
            </ul>
          ) : (
            <div className={`security-empty security-empty--${securityEmptyState.variant}`}>
              <span className="security-icon" aria-hidden="true">
                {securityEmptyState.icon}
              </span>
              <div>
                <strong>{securityEmptyState.title}</strong>
                <p>{securityEmptyState.detail}</p>
              </div>
            </div>
          )}
          <p className="visually-hidden" role="status" aria-atomic="true">
            {securityAnnouncement}
          </p>
        </section>

        <footer className="footer">
          <span>RESQNET · Command & Control</span>
          <span>Prototype UI · Local development</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
