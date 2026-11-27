import { describe, expect, it } from "vitest";
import { dashboardDataSource } from "./dashboardDataSource";
import { demoDashboardData } from "./demoData";

describe("dashboardDataSource", () => {
  it("returns the configured demo dashboard data", async () => {
    await expect(dashboardDataSource.getDashboardData()).resolves.toEqual(
      demoDashboardData,
    );
  });
});
