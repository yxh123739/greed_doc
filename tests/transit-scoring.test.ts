import { describe, expect, it } from "vitest";
import {
  buildStationList,
  calculateTransitScore,
  computeRouteTrips,
  findNearbyGtfsStops,
  scoreTransit,
} from "@/lib/transit-scoring";
import type { ScoredStation, StopData, StopTripsIndex } from "@/lib/transit-types";

function makeStation(
  routeConfigs: {
    routeId: string;
    routeName: string;
    routeType: number;
    directions?: number[];
    dir0WeekdayMin: number;
    dir0WeekendMax: number;
    dir1WeekdayMin: number;
    dir1WeekendMax: number;
  }[]
): StopData {
  const routes: StopData["routes"] = {};

  for (const route of routeConfigs) {
    routes[route.routeId] = {
      routeName: route.routeName,
      routeType: route.routeType,
      directions: route.directions ?? [0, 1],
      dir0WeekdayMin: route.dir0WeekdayMin,
      dir0WeekendMax: route.dir0WeekendMax,
      dir1WeekdayMin: route.dir1WeekdayMin,
      dir1WeekendMax: route.dir1WeekendMax,
    };
  }

  return {
    stopName: "Test Station",
    lat: 40.768,
    lng: -73.982,
    routes,
  };
}

function makeScoredStation(
  stopId: string,
  walkingDistanceMi: number,
  stop: StopData
): ScoredStation {
  return { stopId, walkingDistanceMi, stop };
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

  it("returns 0 points for zero trips", () => {
    expect(calculateTransitScore(0, 0)).toEqual({
      points: 0,
      threshold: null,
    });
  });

  it("returns 0 points when weekday is high but weekend is below all thresholds", () => {
    expect(calculateTransitScore(400, 25)).toEqual({
      points: 0,
      threshold: null,
    });
  });
});

describe("computeRouteTrips", () => {
  it("takes min direction for weekday and weekend", () => {
    expect(
      computeRouteTrips({
        routeName: "1",
        routeType: 1,
        directions: [0, 1],
        dir0WeekdayMin: 142,
        dir0WeekendMax: 98,
        dir1WeekdayMin: 138,
        dir1WeekendMax: 95,
      })
    ).toEqual({ weekdayTrips: 138, weekendTrips: 95 });
  });

  it("returns null for single-direction route", () => {
    expect(
      computeRouteTrips({
        routeName: "X",
        routeType: 1,
        directions: [0],
        dir0WeekdayMin: 100,
        dir0WeekendMax: 50,
        dir1WeekdayMin: 0,
        dir1WeekendMax: 0,
      })
    ).toBeNull();
  });
});

describe("findNearbyGtfsStops", () => {
  it("includes subway stops within 0.5 mi and returns them sorted by distance", () => {
    const index: StopTripsIndex = {
      A: {
        stopName: "Farther",
        lat: 40.77,
        lng: -73.982,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0, 1],
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 100,
            dir1WeekendMax: 80,
          },
        },
      },
      B: {
        stopName: "Closer",
        lat: 40.7685,
        lng: -73.982,
        routes: {
          "2": {
            routeName: "2",
            routeType: 1,
            directions: [0, 1],
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 100,
            dir1WeekendMax: 80,
          },
        },
      },
    };

    const result = findNearbyGtfsStops(index, { lat: 40.768, lng: -73.982 });
    expect(result).toHaveLength(2);
    expect(result[0].stopId).toBe("B");
    expect(result[1].stopId).toBe("A");
  });

  it("excludes subway stops beyond 0.5 mi", () => {
    const index: StopTripsIndex = {
      A: {
        stopName: "Far Away",
        lat: 40.78,
        lng: -73.982,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0, 1],
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 100,
            dir1WeekendMax: 80,
          },
        },
      },
    };

    const result = findNearbyGtfsStops(index, { lat: 40.768, lng: -73.982 });
    expect(result).toHaveLength(0);
  });
});

describe("scoreTransit", () => {
  it("scores a single station with multiple routes", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "120",
        0.15,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 231,
            dir0WeekendMax: 186,
            dir1WeekdayMin: 231,
            dir1WeekendMax: 186,
          },
          {
            routeId: "2",
            routeName: "2",
            routeType: 1,
            dir0WeekdayMin: 162,
            dir0WeekendMax: 139,
            dir1WeekdayMin: 162,
            dir1WeekendMax: 139,
          },
        ])
      ),
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(393);
    expect(result.totalWeekendTrips).toBe(325);
    expect(result.points).toBe(4);
    expect(result.qualifyingStopIds).toEqual(["120"]);
  });

  it("accumulates across multiple stations and deduplicates by routeId", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "A",
        0.1,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 50,
            dir0WeekendMax: 30,
            dir1WeekdayMin: 50,
            dir1WeekendMax: 30,
          },
        ])
      ),
      makeScoredStation(
        "B",
        0.2,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 60,
            dir0WeekendMax: 40,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 40,
          },
          {
            routeId: "2",
            routeName: "2",
            routeType: 1,
            dir0WeekdayMin: 80,
            dir0WeekendMax: 50,
            dir1WeekdayMin: 80,
            dir1WeekendMax: 50,
          },
        ])
      ),
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(130);
    expect(result.totalWeekendTrips).toBe(80);
    expect(result.qualifyingStopIds).toEqual(["A", "B"]);
    expect(result.qualifyingRoutes).toHaveLength(2);
    expect(result.qualifyingRoutes.find((route) => route.routeId === "1")?.stopId).toBe("A");
    expect(result.qualifyingRoutes.find((route) => route.routeId === "2")?.stopId).toBe("B");
  });

  it("stops early when 4 points are reached", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "X",
        0.1,
        makeStation([
          {
            routeId: "A",
            routeName: "A",
            routeType: 1,
            dir0WeekdayMin: 200,
            dir0WeekendMax: 120,
            dir1WeekdayMin: 200,
            dir1WeekendMax: 120,
          },
          {
            routeId: "B",
            routeName: "B",
            routeType: 1,
            dir0WeekdayMin: 200,
            dir0WeekendMax: 120,
            dir1WeekdayMin: 200,
            dir1WeekendMax: 120,
          },
        ])
      ),
      makeScoredStation(
        "Y",
        0.3,
        makeStation([
          {
            routeId: "C",
            routeName: "C",
            routeType: 1,
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 100,
            dir1WeekendMax: 80,
          },
        ])
      ),
    ];

    const result = scoreTransit(stops);
    expect(result.points).toBe(4);
    expect(result.qualifyingStopIds).toEqual(["X"]);
    expect(result.qualifyingRoutes.find((route) => route.routeId === "C")).toBeUndefined();
  });

  it("skips single-direction routes", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "A",
        0.1,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 200,
            dir0WeekendMax: 150,
            dir1WeekdayMin: 200,
            dir1WeekendMax: 150,
          },
        ])
      ),
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(0);
    expect(result.totalWeekendTrips).toBe(0);
    expect(result.qualifyingRoutes).toHaveLength(0);
    expect(result.qualifyingStopIds).toEqual([]);
  });

  it("returns zeroed result for empty input", () => {
    const result = scoreTransit([]);
    expect(result).toEqual({
      qualifyingRoutes: [],
      qualifyingStopIds: [],
      totalWeekdayTrips: 0,
      totalWeekendTrips: 0,
      points: 0,
      threshold: null,
    });
  });

  it("does not mark a station as qualifying if all its routes were already counted", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "A",
        0.1,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 50,
            dir0WeekendMax: 20,
            dir1WeekdayMin: 50,
            dir1WeekendMax: 20,
          },
        ])
      ),
      makeScoredStation(
        "B",
        0.2,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 60,
            dir0WeekendMax: 25,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 25,
          },
        ])
      ),
    ];

    const result = scoreTransit(stops);
    expect(result.qualifyingStopIds).toEqual(["A"]);
    expect(result.totalWeekdayTrips).toBe(50);
    expect(result.totalWeekendTrips).toBe(20);
  });
});

describe("buildStationList", () => {
  it("returns qualifyingStations and allNearbyStations with counted routes only for paired-service stops", () => {
    const stops: ScoredStation[] = [
      makeScoredStation(
        "A",
        0.1,
        makeStation([
          {
            routeId: "1",
            routeName: "1",
            routeType: 1,
            dir0WeekdayMin: 50,
            dir0WeekendMax: 20,
            dir1WeekdayMin: 50,
            dir1WeekendMax: 20,
          },
          {
            routeId: "2",
            routeName: "2",
            routeType: 1,
            dir0WeekdayMin: 30,
            dir0WeekendMax: 10,
            dir1WeekdayMin: 30,
            dir1WeekendMax: 10,
          },
        ])
      ),
      makeScoredStation(
        "B",
        0.2,
        makeStation([
          {
            routeId: "X",
            routeName: "X",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 40,
            dir0WeekendMax: 20,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        ])
      ),
    ];

    const scoreResult = {
      qualifyingRoutes: [
        {
          routeId: "1",
          routeName: "1",
          routeType: 1,
          stopId: "A",
          stopName: "Test Station",
          weekdayTrips: 50,
          weekendTrips: 20,
        },
      ],
      qualifyingStopIds: ["A"],
      totalWeekdayTrips: 50,
      totalWeekendTrips: 20,
      points: 1,
      threshold: { weekday: 72, weekend: 30 },
    };

    const result = buildStationList(stops, scoreResult);
    expect(result.allNearbyStations).toHaveLength(1);
    expect(result.qualifyingStations).toHaveLength(1);
    expect(result.allNearbyStations[0].stopId).toBe("A");
    expect(result.allNearbyStations[0].stationType).toBe("subway");
    expect(result.allNearbyStations[0].routes).toHaveLength(2);
    expect(result.allNearbyStations[0].routes.find((route) => route.routeId === "1")?.counted).toBe(true);
    expect(result.allNearbyStations[0].routes.find((route) => route.routeId === "2")?.counted).toBe(false);
  });
});
