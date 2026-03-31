import { describe, it, expect } from "vitest";
import {
  calculateTransitScore,
  findNearbyGtfsStops,
  computeRouteTrips,
  deduplicateRoutes,
} from "@/lib/transit-scoring";
import type { StopTripsIndex, StopData } from "@/lib/transit-types";

function makeSubwayStop(overrides?: Partial<StopData>): StopData {
  return {
    stopName: "Test Station",
    lat: 40.768,
    lng: -73.982,
    parentStation: "100",
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
    ...overrides,
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

  it("returns lower tier when only weekend fails higher tier (PDF M5 example: 60 weekday, 0 weekend)", () => {
    expect(calculateTransitScore(60, 0)).toEqual({
      points: 0,
      threshold: null,
    });
  });
});

describe("findNearbyGtfsStops", () => {
  it("includes subway stops within 0.5 mi", () => {
    const index: StopTripsIndex = {
      "101N": makeSubwayStop({ lat: 40.768, lng: -73.982 }),
    };
    const center = { lat: 40.767, lng: -73.981 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(1);
    expect(result[0].stopId).toBe("101N");
  });

  it("excludes subway stops beyond 0.5 mi", () => {
    const index: StopTripsIndex = {
      "101N": makeSubwayStop({ lat: 40.780, lng: -73.982 }),
    };
    const center = { lat: 40.768, lng: -73.982 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(0);
  });

  it("excludes bus stops beyond 0.25 mi", () => {
    const index: StopTripsIndex = {
      "B1": {
        stopName: "Bus Stop",
        lat: 40.7725,
        lng: -73.982,
        parentStation: "",
        routes: {
          M5: {
            routeName: "M5",
            routeType: 3,
            directions: [0, 1],
            dir0WeekdayMin: 60,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 0,
          },
        },
      },
    };
    const center = { lat: 40.768, lng: -73.982 }; // ~0.31 mi away
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(0);
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
    const result = computeRouteTrips(route);
    expect(result).toEqual({ weekdayTrips: 138, weekendTrips: 95 });
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
    const result = computeRouteTrips(route);
    expect(result).toBeNull();
  });
});

describe("deduplicateRoutes", () => {
  it("keeps only the stop with highest weekday trips for the same route", () => {
    const candidates = [
      { routeId: "1", routeName: "1", routeType: 1, stopId: "A", stopName: "Stop A", weekdayTrips: 100, weekendTrips: 80 },
      { routeId: "1", routeName: "1", routeType: 1, stopId: "B", stopName: "Stop B", weekdayTrips: 120, weekendTrips: 90 },
      { routeId: "A", routeName: "A", routeType: 1, stopId: "A", stopName: "Stop A", weekdayTrips: 150, weekendTrips: 110 },
    ];
    const result = deduplicateRoutes(candidates);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.routeId === "1")?.stopId).toBe("B");
    expect(result.find((r) => r.routeId === "A")?.stopId).toBe("A");
  });
});
