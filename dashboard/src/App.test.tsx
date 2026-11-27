import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardDataSource } from "./data/dashboardDataSource";
import { demoDashboardData } from "./data/demoData";
import type { DashboardData } from "./types/dashboard";
import App from "./App";

vi.mock("./data/dashboardDataSource", () => ({
  dashboardDataSource: {
    getDashboardData: vi.fn(),
  },
}));

function backendData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    ...demoDashboardData,
    source: "backend",
    ...overrides,
  };
}

function metricCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest("article");
  if (!card) {
    throw new Error(`Could not find summary card for ${label}.`);
  }
  return card;
}

async function renderDashboard(data: DashboardData) {
  vi.mocked(dashboardDataSource.getDashboardData).mockResolvedValue(data);
  render(<App />);
  await waitFor(() => {
    expect(screen.queryByText("Loading dashboard data…")).not.toBeInTheDocument();
  });
}

describe("RESQNET dashboard", () => {
  beforeEach(() => {
    vi.mocked(dashboardDataSource.getDashboardData).mockResolvedValue(
      demoDashboardData,
    );
  });

  it("renders the command center and its main navigation sections", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Emergency Command Center" }),
    ).toBeInTheDocument();
    const navigation = screen.getByRole("navigation");
    for (const section of [
      "Overview",
      "SOS Alerts",
      "Network Nodes",
      "Incident Map",
      "Security Events",
    ]) {
      expect(
        within(navigation).getByRole("link", { name: new RegExp(section) }),
      ).toBeVisible();
    }
  });

  it("links to the accessible SOS Alerts panel", async () => {
    await renderDashboard(demoDashboardData);

    const navigationLink = within(screen.getByRole("navigation")).getByRole(
      "link",
      { name: /SOS Alerts/ },
    );
    const alertsPanel = screen.getByRole("article", {
      name: "Incoming SOS alerts",
    });

    expect(navigationLink).toHaveAttribute("href", "#alerts");
    expect(document.getElementById("alerts")).toBe(alertsPanel);
  });

  it("links to the accessible static Incident Map placeholder", async () => {
    await renderDashboard(demoDashboardData);

    const navigationLink = within(screen.getByRole("navigation")).getByRole(
      "link",
      { name: /Incident Map/ },
    );
    const mapPanel = screen.getByRole("article", { name: "Incident map" });

    expect(navigationLink).toHaveAttribute("href", "#map");
    expect(document.getElementById("map")).toBe(mapPanel);
    expect(
      within(mapPanel).getByRole("heading", { name: "Incident map" }),
    ).toBeInTheDocument();
    expect(
      within(mapPanel).getByText("Map integration pending"),
    ).toBeInTheDocument();
    expect(
      within(mapPanel).getByText(
        "This map area is a placeholder. Real incident locations are not currently available.",
      ),
    ).toBeInTheDocument();
    expect(within(mapPanel).getByText("NO LIVE LOCATIONS")).toBeInTheDocument();
    expect(within(mapPanel).getByText("⌖")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("shows summary cards populated with demo data", async () => {
    await renderDashboard(demoDashboardData);

    expect(metricCard("SOS ALERTS")).toHaveTextContent("03");
    expect(metricCard("NETWORK NODES")).toHaveTextContent("—");
    expect(metricCard("GATEWAY STATUS")).toHaveTextContent("Not connected");
    expect(metricCard("SECURITY EVENTS")).toHaveTextContent("0");
    expect(metricCard("SECURITY EVENTS")).toHaveTextContent(
      "Awaiting security event data",
    );
    expect(screen.getByText("Demo mode · Not connected")).toBeInTheDocument();
  });

  it.each(["Connected", "Not connected", "Unknown"] as const)(
    "renders the %s gateway state and supplied detail",
    async (connectionState) => {
      const detail = "Gateway detail supplied by the data source";
      await renderDashboard(
        backendData({
          gatewayStatus: { connectionState, detail },
        }),
      );

      const gatewayCard = screen.getByRole("article", {
        name: "GATEWAY STATUS",
      });
      expect(gatewayCard).toHaveTextContent(connectionState);
      expect(gatewayCard).toHaveTextContent(detail);
    },
  );

  it("links Network Nodes navigation to the dedicated panel and shows its empty state", async () => {
    await renderDashboard(demoDashboardData);

    const navigationLink = within(screen.getByRole("navigation")).getByRole(
      "link",
      { name: /Network Nodes/ },
    );
    const nodesPanel = screen.getByRole("region", { name: "Network nodes" });

    expect(navigationLink).toHaveAttribute("href", "#nodes");
    expect(document.getElementById("nodes")).toBe(nodesPanel);
    expect(
      within(nodesPanel).getByText("No network nodes available"),
    ).toBeInTheDocument();
    expect(
      within(nodesPanel).getByText(
        "Node records will appear here when supplied by the RESQNET data source.",
      ),
    ).toBeInTheDocument();
    expect(within(nodesPanel).queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders supplied network nodes with their names, IDs, and statuses", async () => {
    const data = backendData({
      networkNodes: [
        {
          id: "node-001",
          name: "North relay",
          status: "Online",
        },
        {
          id: "node-002",
          name: "West relay",
          status: "Offline",
        },
        {
          id: "node-003",
          name: "Unknown relay",
          status: "Unknown",
        },
      ],
    });
    await renderDashboard(data);

    const nodesPanel = screen.getByRole("region", { name: "Network nodes" });
    const nodeCards = within(nodesPanel).getAllByRole("listitem");

    expect(nodeCards).toHaveLength(3);
    for (const [index, node] of data.networkNodes.entries()) {
      expect(nodeCards[index]).toHaveTextContent(node.name);
      expect(nodeCards[index]).toHaveTextContent(node.id);
      expect(nodeCards[index]).toHaveTextContent(node.status);
    }
    expect(metricCard("NETWORK NODES")).toHaveTextContent("3");
    expect(
      within(nodesPanel).queryByText("No network nodes available"),
    ).not.toBeInTheDocument();
  });

  it("renders long supplied node names and IDs", async () => {
    const longName = "North relay ".repeat(12).trim();
    const longId = "node-id-".repeat(16);
    await renderDashboard(
      backendData({
        networkNodes: [{ id: longId, name: longName, status: "Online" }],
      }),
    );

    const nodesPanel = screen.getByRole("region", { name: "Network nodes" });
    const nodeCard = within(nodesPanel).getByRole("listitem");

    expect(within(nodeCard).getByRole("heading", { name: longName })).toBeVisible();
    expect(within(nodeCard).getByText(longId)).toBeVisible();
    expect(within(nodeCard).getByText(longId)).toHaveClass("node-field-value");
  });

  it("shows loading state while node records are pending", () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockImplementation(
      () => new Promise<DashboardData>(() => {}),
    );
    render(<App />);

    const nodesPanel = screen.getByRole("region", { name: "Network nodes" });
    expect(
      within(nodesPanel).getByText("Loading network node data…", {
        selector: ".nodes-empty strong",
      }),
    ).toBeInTheDocument();
    expect(within(nodesPanel).getByRole("status")).toHaveTextContent(
      "Loading network node data…",
    );
  });

  it("shows the node data-source error state without substituting demo nodes", async () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockRejectedValue(
      new Error("Dashboard data unavailable"),
    );
    render(<App />);

    const nodesPanel = screen.getByRole("region", { name: "Network nodes" });
    expect(
      await within(nodesPanel).findByText("Network node data unavailable", {
        selector: ".nodes-empty strong",
      }),
    ).toBeInTheDocument();
    expect(within(nodesPanel).getByRole("status")).toHaveTextContent(
      "Network node data unavailable",
    );
    expect(within(nodesPanel).queryByRole("list")).not.toBeInTheDocument();
    expect(within(nodesPanel).queryByText("North relay")).not.toBeInTheDocument();
  });

  it("renders demo SOS alerts with their priority values", async () => {
    await renderDashboard(demoDashboardData);

    const alertPanel = screen
      .getByRole("heading", { name: "Incoming SOS alerts" })
      .closest("article");
    if (!alertPanel) {
      throw new Error("Could not find the SOS alerts panel.");
    }
    const alertList = within(alertPanel).getByRole("list");
    const alertRows = within(alertList).getAllByRole("listitem");
    expect(alertRows).toHaveLength(3);
    expect(within(alertRows[0]).getByText("!")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(alertRows[0]).getByRole("button", {
        name: "Dismiss demo alert SOS-001: Medical emergency",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Medical emergency")).toBeInTheDocument();
    expect(screen.getByText("SOS-001")).toBeInTheDocument();
    expect(screen.getByText("Demo location A")).toBeInTheDocument();
    expect(screen.getByText("Flood rescue")).toBeInTheDocument();
    expect(screen.getByText("General assistance")).toBeInTheDocument();
    expect(screen.getAllByText("Critical")).toHaveLength(2);
    expect(screen.getAllByText("High")).toHaveLength(2);
    expect(screen.getAllByText("Medium")).toHaveLength(2);
  });

  it("shows verification details when a source supplies them", async () => {
    const data = backendData({
      alerts: [
        { ...demoDashboardData.alerts[0], verificationStatus: "Verified" },
        { ...demoDashboardData.alerts[1], verificationStatus: "Pending" },
      ],
    });
    await renderDashboard(data);

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("omits verification details when the optional field is absent", async () => {
    await renderDashboard(demoDashboardData);

    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("filters alerts to the selected priority", async () => {
    const user = userEvent.setup();
    await renderDashboard(demoDashboardData);

    await user.selectOptions(screen.getByLabelText("Filter by priority"), "High");

    expect(screen.getByText("Flood rescue")).toBeInTheDocument();
    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
    expect(screen.queryByText("General assistance")).not.toBeInTheDocument();
  });

  it("supports exactly the available alert priority filters", async () => {
    const user = userEvent.setup();
    await renderDashboard(demoDashboardData);

    const filter = screen.getByLabelText("Filter by priority");
    expect(
      within(filter).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["All priorities", "Critical", "High", "Medium"]);

    await user.selectOptions(filter, "Critical");
    expect(screen.getByText("Medical emergency")).toBeInTheDocument();
    expect(screen.queryByText("Flood rescue")).not.toBeInTheDocument();
    expect(screen.queryByText("General assistance")).not.toBeInTheDocument();

    await user.selectOptions(filter, "Medium");
    expect(screen.getByText("General assistance")).toBeInTheDocument();
    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
    expect(screen.queryByText("Flood rescue")).not.toBeInTheDocument();

    await user.selectOptions(filter, "All");
    expect(screen.getByText("Medical emergency")).toBeInTheDocument();
    expect(screen.getByText("Flood rescue")).toBeInTheDocument();
    expect(screen.getByText("General assistance")).toBeInTheDocument();
  });

  it("shows the empty filter result when no alert matches", async () => {
    const data = backendData({
      alerts: [demoDashboardData.alerts[0]],
    });
    const user = userEvent.setup();
    await renderDashboard(data);

    await user.selectOptions(
      screen.getByLabelText("Filter by priority"),
      "Medium",
    );

    expect(screen.getByText("No alerts match this filter.")).toBeInTheDocument();
  });

  it("dismisses a demo alert from the list and summary count", async () => {
    const user = userEvent.setup();
    await renderDashboard(demoDashboardData);

    await user.click(
      screen.getByRole("button", {
        name: "Dismiss demo alert SOS-001: Medical emergency",
      }),
    );

    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
    expect(metricCard("SOS ALERTS")).toHaveTextContent("02");
    expect(screen.getByText(
      "Demo alert SOS-001 (Medical emergency) was dismissed from this temporary view.",
      { selector: ".visually-hidden" },
    )).toHaveTextContent(
      "Demo alert SOS-001 (Medical emergency) was dismissed from this temporary view.",
    );
  });

  it("dismisses a demo alert while its priority filter is active", async () => {
    const user = userEvent.setup();
    await renderDashboard(demoDashboardData);

    await user.selectOptions(screen.getByLabelText("Filter by priority"), "High");
    await user.click(
      screen.getByRole("button", {
        name: "Dismiss demo alert SOS-002: Flood rescue",
      }),
    );

    expect(screen.getByText("No alerts match this filter.")).toBeInTheDocument();
    expect(screen.queryByText("Flood rescue")).not.toBeInTheDocument();
    expect(metricCard("SOS ALERTS")).toHaveTextContent("02");
    expect(
      screen.getByText(
        "Demo alert SOS-002 (Flood rescue) was dismissed from this temporary view.",
        { selector: ".visually-hidden" },
      ),
    ).toBeInTheDocument();
  });

  it("supports keyboard focus and native Enter activation for demo dismissal", async () => {
    const user = userEvent.setup();
    await renderDashboard(demoDashboardData);

    const dismissButton = screen.getByRole("button", {
      name: "Dismiss demo alert SOS-001: Medical emergency",
    });
    dismissButton.focus();
    expect(dismissButton).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Demo alert SOS-001 (Medical emergency) was dismissed from this temporary view.",
        { selector: ".visually-hidden" },
      ),
    ).toBeInTheDocument();
  });

  it("does not show demo dismissal controls for backend-shaped alerts", async () => {
    await renderDashboard(
      backendData({ alerts: [demoDashboardData.alerts[0]] }),
    );

    expect(screen.getByText("Medical emergency")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Dismiss demo alert/ }),
    ).not.toBeInTheDocument();
  });

  it("renders an empty alert list", async () => {
    await renderDashboard(backendData({ alerts: [] }));

    expect(screen.getByText("No alerts match this filter.")).toBeInTheDocument();
    expect(metricCard("SOS ALERTS")).toHaveTextContent("00");
    expect(
      screen.queryByRole("button", { name: /Dismiss demo alert/ }),
    ).not.toBeInTheDocument();
  });

  it("shows loading state for alerts while dashboard data is pending", () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockImplementation(
      () => new Promise<DashboardData>(() => {}),
    );
    render(<App />);

    expect(screen.getByText("Loading dashboard data…")).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "Incoming SOS alerts" }),
    ).toBeInTheDocument();
  });

  it("shows data-source errors in the alert list instead of demo alerts", async () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockRejectedValue(
      new Error("SOS alert data unavailable"),
    );
    render(<App />);

    expect(
      await screen.findByText("SOS alert data unavailable", {
        selector: ".alert-list .empty-state",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Dismiss demo alert/ }),
    ).not.toBeInTheDocument();
  });

  it("shows demo mode and the disconnected security-feed state", async () => {
    await renderDashboard(demoDashboardData);

    expect(screen.getByText("Demo data · Feed not connected")).toBeInTheDocument();
    expect(
      screen.getByText("Demo data; no live security feed connected"),
    ).toBeInTheDocument();
  });

  it("shows a connected feed only when the data reports connected", async () => {
    await renderDashboard(
      backendData({ securityFeedStatus: "connected", securityEvents: [] }),
    );

    expect(screen.getByText("Feed connected")).toBeInTheDocument();
    expect(
      screen.getByText("Security feed connected; no events reported"),
    ).toBeInTheDocument();
  });

  it("distinguishes an unknown security-feed status", async () => {
    await renderDashboard(
      backendData({ securityFeedStatus: "unknown", securityEvents: [] }),
    );

    expect(screen.getByText("Feed status unknown")).toBeInTheDocument();
    expect(screen.getByText("Security feed status unknown")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Security event monitoring" }))
        .getByRole("status"),
    ).toHaveTextContent("Feed status unknown");
  });

  it("shows the empty security-event state for a disconnected feed", async () => {
    await renderDashboard(
      backendData({ securityFeedStatus: "not-connected", securityEvents: [] }),
    );

    expect(screen.getByText("Feed not connected")).toBeInTheDocument();
    expect(screen.getByText("Security feed not connected")).toBeInTheDocument();
    const securityPanel = screen.getByRole("region", {
      name: "Security event monitoring",
    });
    expect(
      within(securityPanel).getByText("!", { selector: ".security-icon" }),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the initial security-feed loading state without claiming there are no events", () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockImplementation(
      () => new Promise<DashboardData>(() => {}),
    );
    render(<App />);

    const securityPanel = screen.getByRole("region", {
      name: "Security event monitoring",
    });
    expect(within(securityPanel).getByText("Checking feed")).toBeInTheDocument();
    expect(within(securityPanel).getByText("Checking security feed")).toBeInTheDocument();
    expect(within(securityPanel).getByRole("status")).toHaveTextContent(
      "Checking feed. Security event status is loading.",
    );
    expect(
      within(securityPanel).queryByText(/no events reported|no events received/i),
    ).not.toBeInTheDocument();
  });

  it("renders multiple supplied events with semantic time markup and an accessible panel name", async () => {
    await renderDashboard(
      backendData({
        securityFeedStatus: "connected",
        securityEvents: [
          {
            id: "SEC-001",
            description: "Invalid signature detected",
            time: "10:44 AM",
          },
          {
            id: "SEC-002",
            description: "Suspicious node activity reported",
            time: "11:02 AM",
          },
        ],
      }),
    );

    const securityPanel = screen.getByRole("region", {
      name: "Security event monitoring",
    });
    const eventList = within(securityPanel).getByRole("list");
    const events = within(eventList).getAllByRole("listitem");
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveTextContent("Invalid signature detected");
    expect(events[1]).toHaveTextContent("Suspicious node activity reported");

    const eventTime = events[0].querySelector("time");
    expect(eventTime).toHaveTextContent("10:44 AM");
    expect(eventTime).not.toHaveAttribute("datetime");
    expect(events[1].querySelector("time")).toHaveTextContent("11:02 AM");
    expect(within(securityPanel).getByRole("status")).toHaveTextContent(
      "2 security events supplied",
    );
  });

  it("handles absent gateway details without inventing a connection state", async () => {
    await renderDashboard(backendData({ gatewayStatus: null }));

    expect(metricCard("GATEWAY STATUS")).toHaveTextContent("Awaiting gateway data");
    expect(metricCard("GATEWAY STATUS")).not.toHaveTextContent("Connected");
  });

  it("displays data-source errors instead of showing demo data", async () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockRejectedValue(
      new Error("Dashboard data unavailable"),
    );
    render(<App />);

    expect(
      await screen.findByText("Dashboard data unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Feed unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Security event data unavailable"),
    ).toBeInTheDocument();
    const securityPanel = screen.getByRole("region", {
      name: "Security event monitoring",
    });
    expect(within(securityPanel).getByRole("status")).toHaveTextContent(
      "Feed unavailable. Security event data unavailable.",
    );
    expect(within(securityPanel).getByText("Security event data unavailable")
      .closest(".security-empty")).toHaveClass("security-empty--error");
    expect(within(securityPanel).getByText("!")
      .closest(".security-icon")).not.toHaveClass("security-icon--connected");
    expect(screen.queryByText("Medical emergency")).not.toBeInTheDocument();
  });

  it("uses a safe message when a data-source rejection is not an Error", async () => {
    vi.mocked(dashboardDataSource.getDashboardData).mockRejectedValue(
      "unexpected failure",
    );
    render(<App />);

    expect(
      await screen.findByText("Unable to load dashboard data."),
    ).toBeInTheDocument();
    expect(screen.getByText("Feed unavailable")).toBeInTheDocument();
  });
});
