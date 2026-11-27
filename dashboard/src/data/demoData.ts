import type { DashboardData } from "../types/dashboard";

export const demoDashboardData: DashboardData = {
  source: "demo",
  alerts: [
    {
      id: "SOS-001",
      type: "Medical emergency",
      location: "Demo location A",
      time: "10:42 AM",
      priority: "Critical",
    },
    {
      id: "SOS-002",
      type: "Flood rescue",
      location: "Demo location B",
      time: "10:39 AM",
      priority: "High",
    },
    {
      id: "SOS-003",
      type: "General assistance",
      location: "Demo location C",
      time: "10:31 AM",
      priority: "Medium",
    },
  ],
  networkNodes: [],
  gatewayStatus: {
    connectionState: "Not connected",
    detail: "No gateway API configured",
  },
  securityFeedStatus: "not-connected",
  securityEvents: [],
};
