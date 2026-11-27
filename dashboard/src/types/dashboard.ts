export type AlertPriority = "Critical" | "High" | "Medium";

export type AlertVerificationStatus = "Verified" | "Pending";

export interface SosAlert {
  id: string;
  type: string;
  location: string;
  time: string;
  priority: AlertPriority;
  verificationStatus?: AlertVerificationStatus;
}

export interface NetworkNode {
  id: string;
  name: string;
  status: "Online" | "Offline" | "Unknown";
}

export interface GatewayStatus {
  connectionState: "Connected" | "Not connected" | "Unknown";
  detail: string;
}

export interface SecurityEvent {
  id: string;
  description: string;
  time: string;
}

export type SecurityFeedStatus = "connected" | "not-connected" | "unknown";

export interface DashboardData {
  source: "demo" | "backend";
  alerts: SosAlert[];
  networkNodes: NetworkNode[];
  gatewayStatus: GatewayStatus | null;
  securityFeedStatus: SecurityFeedStatus;
  securityEvents: SecurityEvent[];
}

export interface DashboardDataSource {
  getDashboardData(): Promise<DashboardData>;
}
