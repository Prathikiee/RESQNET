import { demoDashboardData } from "./demoData";
import type { DashboardDataSource } from "../types/dashboard";

export const dashboardDataSource: DashboardDataSource = {
  async getDashboardData() {
    return demoDashboardData;
  },
};
