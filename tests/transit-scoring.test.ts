import { describe, expect, it } from "vitest";
import {
  calculateTransitScore,
  computeRouteTrips,
  findNearbyGtfsStops,
  scoreTransit,
} from "@/lib/transit-scoring";
import type { ScoredStation, StopData } from "@/lib/transit-types";

function makeStation(
  routeConfigs: {
    routeId: string;
    routeName: string;
    dir0WeekdayMin: number;
    dir0WeekendMax: number;
    dir1WeekdayMin: number;
    dir1WeekendMax: number;
  }[]
): StopData {
  const routes: StopData["routes"] = {};

  for (const routeConfig of routeConfigs) {
    routes[routeConfig.routeId] = {
      routeName: routeConfig.routeName,
      routeType: 1,
      directions: [0, 1],
      dir0WeekdayMin: routeConfig.dir0WeekdayMin,
      dir0WeekendMax: routeConfig.dir0WeekendMax,
      dir1WeekdayMin: routeConfig.dir1WeekdayMin,
      dir1WeekendMax: routeConfig.dir1WeekendMax,
    };
  }

  return {
    stopName: "Test Station",
    lat: 40.768,
    lng: -73.982,
    routes,
  };
}

describe("calculateTransitScore", () => {
  it("returns 4 points for 360+ weekday and 216+ weekend", () => {
    expect(calculateTransitScore(400, 220)).toEqual({
      points: 4,
      threshold: { weekday: 360, weekend: 216 },
    });
  });

  it("returns 3 points for 160+ weekday and 120+ weekend", () => {
    expect(calculateTransitScore(200, 150)).toEqual({
      points: 3,
      threshold: { weekday: 160, weekend: 120 },
    });
  });

  it("returns 2 points for 132+ weekday and 78+ weekend", () => {
    expect(calculateTransitScore(140, 80)).toEqual({
      points: 2,
      threshold: { weekday: 132, weekend: 78 },
    });
  });

  it("returns 1 point for 72+ weekday and 30+ weekend", () => {
    expect(calculateTransitScore(80, 35)).toEqual({
      points: 1,
      threshold: { weekday: 72, weekend: 30 },
    });
  });

  it("returns 0 points when weekday is high but weekend is below all thresholds", () => {
    expect(calculateTransitScore(400, 25)).toEqual({
      points: 0,
      threshold: null,
    });
  });

  it("returns 0 points for zero trips", () => {
    expect(calculateTransitScore(0, 0)).toEqual({
      points: 0,
      threshold: null,
    });
  });
});

describe("computeRouteTrips", () => {
  it("takes min direction for weekday, min direction for weekend", () => {
    const route = {
      routeName: "1",
      routeType: 1,
      directions: [0, 1],
      dir0WeekdayMin: 142,
      dir0WeekendMax: 98,
      dir1WeekdayMin: 138,
      dir1WeekendMax: 95,
    };

    expect(computeRouteTrips(route)).toEqual({ weekdayTrips: 138, weekendTrips: 95 });
  });

  it("returns null for single-direction route (no paired service)", () => {
    const route = {
      routeName: "X",
      routeType: 1,
      directions: [0],
      dir0WeekdayMin: 100,
      dir0WeekendMax: 50,
      dir1WeekdayMin: 0,
      dir1WeekendMax: 0,
    };

    expect(computeRouteTrips(route)).toBeNull();
  });
});

describe("scoreTransit (station-by-station accumulation)", () => {
  it("scores a single station with multiple routes", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "120",
        walkingDistanceMi: 0.15,
        stop: makeStation([
          {
            routeId: "1",
            routeName: "1",
            dir0WeekdayMin: 231,
            dir0WeekendMax: 186,
            dir1WeekdayMin: 231,
            dir1WeekendMax: 186,
          },
          {
            routeId: "2",
            routeName: "2",
            dir0WeekdayMin: 162,
            dir0WeekendMax: 139,
            dir1WeekdayMin: 162,
            dir1WeekendMax: 139,
          },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(231 + 162);
    expect(result.totalWeekendTrips).toBe(186 + 139);
    expect(result.points).toBe(4);
    expect(result.qualifyingStopIds).toEqual(["120"]);
  });

  it("accumulates across multiple stations, deduplicates routes", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "A",
        walkingDistanceMi: 0.1,
        stop: makeStation([
          {
            routeId: "1",
            routeName: "1",
            dir0WeekdayMin: 50,
            dir0WeekendMax: 30,
            dir1WeekdayMin: 50,
            dir1WeekendMax: 30,
          },
        ]),
      },
      {
        stopId: "B",
        walkingDistanceMi: 0.2,
        stop: makeStation([
          {
            routeId: "1",
            routeName: "1",
            dir0WeekdayMin: 60,
            dir0WeekendMax: 40,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 40,
          },
          {
            routeId: "2",
            routeName: "2",
            dir0WeekdayMin: 80,
            dir0WeekendMax: 50,
            dir1WeekdayMin: 80,
            dir1WeekendMax: 50,
          },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(50 + 80);
    expect(result.totalWeekendTrips).toBe(30 + 50);
    expect(result.qualifyingStopIds).toEqual(["A", "B"]);
    expect(result.qualifyingRoutes).toHaveLength(2);
    expect(result.qualifyingRoutes.find((route) => route.routeId === "1")?.stopId).toBe("A");
    expect(result.qualifyingRoutes.find((route) => route.routeId === "2")?.stopId).toBe("B");
  });

  it("stops early when 4 points reached", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "X",
        walkingDistanceMi: 0.1,
        stop: makeStation([
          {
            routeId: "A",
            routeName: "A",
            dir0WeekdayMin: 200,
            dir0WeekendMax: 120,
            dir1WeekdayMin: 200,
            dir1WeekendMax: 120,
          },
          {
            routeId: "B",
            routeName: "B",
            dir0WeekdayMin: 200,
            dir0WeekendMax: 120,
            dir1WeekdayMin: 200,
            dir1WeekendMax: 120,
          },
        ]),
      },
      {
        stopId: "Y",
        walkingDistanceMi: 0.3,
        stop: makeStation([
          {
            routeId: "C",
            routeName: "C",
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 100,
            dir1WeekendMax: 80,
          },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    expect(result.points).toBe(4);
    expect(result.qualifyingStopIds).toEqual(["X"]);
    expect(result.qualifyingRoutes.find((route) => route.routeId === "C")).toBeUndefined();
  });

  it("skips single-direction routes (no paired service)", () => {
    const stop = makeStation([
      {
        routeId: "1",
        routeName: "1",
        dir0WeekdayMin: 200,
        dir0WeekendMax: 150,
        dir1WeekdayMin: 200,
        dir1WeekendMax: 150,
      },
    ]);
    stop.routes["1"].directions = [0];

    const stops: ScoredStation[] = [{ stopId: "A", walkingDistanceMi: 0.1, stop }];
    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(0);
    expect(result.qualifyingRoutes).toHaveLength(0);
    expect(result.qualifyingStopIds).toEqual([]);
  });

  it("returns 0 for empty input", () => {
    const result = scoreTransit([]);
    expect(result.points).toBe(0);
    expect(result.totalWeekdayTrips).toBe(0);
    expect(result.totalWeekendTrips).toBe(0);
    expect(result.qualifyingRoutes).toEqual([]);
    expect(result.qualifyingStopIds).toEqual([]);
  });

  it("does not mark station as qualifying if all its routes already counted", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "A",
        walkingDistanceMi: 0.1,
        stop: makeStation([
          {
            routeId: "1",
            routeName: "1",
            dir0WeekdayMin: 50,
            dir0WeekendMax: 20,
            dir1WeekdayMin: 50,
            dir1WeekendMax: 20,
          },
        ]),
      },
      {
        stopId: "B",
        walkingDistanceMi: 0.2,
        stop: makeStation([
          {
            routeId: "1",
            routeName: "1",
            dir0WeekdayMin: 60,
            dir0WeekendMax: 25,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 25,
          },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    expect(result.qualifyingStopIds).toEqual(["A"]);
    expect(result.totalWeekdayTrips).toBe(50);
  });
});

describe("findNearbyGtfsStops", () => {
  it("includes subway stops within 0.5 mi", () => {
    const index = {
      "120": {
        stopName: "96 St",
        lat: 40.768,
        lng: -73.982,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0, 1],
            dir0WeekdayMin: 142,
            dir0WeekendMax: 98,
            dir1WeekdayMin: 138,
            dir1WeekendMax: 95,
          },
        },
      },
    };
    const center = { lat: 40.767, lng: -73.981 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(1);
    expect(result[0].stopId).toBe("120");
  });

  it("excludes subway stops beyond 0.5 mi", () => {
    const index = {
      "120": {
        stopName: "96 St",
        lat: 40.78,
        lng: -73.982,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0, 1],
            dir0WeekdayMin: 142,
            dir0WeekendMax: 98,
            dir1WeekdayMin: 138,
            dir1WeekendMax: 95,
          },
        },
      },
    };
    const center = { lat: 40.768, lng: -73.982 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(0);
  });
});
