import { describe, it, expect } from "vitest";
import {
  getScheduleGroups,
  ROUTE_TO_SCHEDULE,
} from "@/lib/mta-schedules";

describe("ROUTE_TO_SCHEDULE", () => {
  it("maps every NYC subway route to a schedule group", () => {
    const allRoutes = [
      "1","2","3","4","5","6","7",
      "A","C","E","B","D","F","M",
      "G","J","Z","L",
      "N","Q","R","W","S","SIR",
    ];
    for (const route of allRoutes) {
      expect(ROUTE_TO_SCHEDULE[route]).toBeDefined();
    }
  });
});

describe("getScheduleGroups", () => {
  it("deduplicates routes that share the same schedule PDF", () => {
    const routeNames = ["1", "2", "3"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toEqual(["1-2-3"]);
  });

  it("returns multiple groups for routes on different PDFs", () => {
    const routeNames = ["1", "A", "L"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toHaveLength(3);
    expect(groups).toContain("1-2-3");
    expect(groups).toContain("A-C-E");
    expect(groups).toContain("L");
  });

  it("skips routes not in the mapping", () => {
    const routeNames = ["1", "UNKNOWN_ROUTE"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toEqual(["1-2-3"]);
  });

  it("returns empty array for empty input", () => {
    expect(getScheduleGroups([])).toEqual([]);
  });
});
