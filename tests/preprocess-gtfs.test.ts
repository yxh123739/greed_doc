import { describe, it, expect } from "vitest";
import {
  parseCalendar,
  parseRoutes,
  parseTrips,
  aggregateStopTrips,
  mergeNSPlatforms,
} from "@/scripts/preprocess-gtfs";
import type { StopTripsIndex } from "@/lib/transit-types";

describe("parseCalendar", () => {
  it("parses weekday service correctly", () => {
    const csv = `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
SVC-WK,1,1,1,1,1,0,0,20251103,20260515`;
    const result = parseCalendar(csv);
    expect(result.get("SVC-WK")).toEqual({
      monday: true, tuesday: true, wednesday: true,
      thursday: true, friday: true, saturday: false, sunday: false,
    });
  });

  it("parses sunday-only service", () => {
    const csv = `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
SVC-SUN,0,0,0,0,0,0,1,20251102,20260510`;
    const result = parseCalendar(csv);
    expect(result.get("SVC-SUN")?.sunday).toBe(true);
    expect(result.get("SVC-SUN")?.monday).toBe(false);
  });
});

describe("parseRoutes", () => {
  it("extracts route_short_name and route_type", () => {
    const csv = `agency_id,route_id,route_short_name,route_long_name,route_type,route_desc,route_url,route_color,route_text_color,route_sort_order
MTA NYCT,1,1,Broadway - 7 Avenue Local,1,desc,url,D82233,FFFFFF,20`;
    const result = parseRoutes(csv);
    expect(result.get("1")).toEqual({ routeName: "1", routeType: 1 });
  });
});

describe("parseTrips", () => {
  it("maps trip_id to route/service/direction", () => {
    const csv = `route_id,trip_id,service_id,trip_headsign,direction_id,shape_id
1,TRIP001,SVC-WK,South Ferry,1,shape1`;
    const result = parseTrips(csv);
    expect(result.get("TRIP001")).toEqual({
      routeId: "1",
      serviceId: "SVC-WK",
      directionId: 1,
    });
  });
});

describe("aggregateStopTrips", () => {
  it("counts weekday-min and weekend-max per stop per route per direction", () => {
    const calendar = new Map([
      ["SVC-WK", { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false }],
      ["SVC-SAT", { monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: true, sunday: false }],
    ]);
    const trips = new Map([
      ["T1", { routeId: "1", serviceId: "SVC-WK", directionId: 0 }],
      ["T2", { routeId: "1", serviceId: "SVC-WK", directionId: 0 }],
      ["T3", { routeId: "1", serviceId: "SVC-SAT", directionId: 0 }],
    ]);
    const stopTimeTripIds = new Map([
      ["101N", new Set(["T1", "T2", "T3"])],
    ]);
    const routes = new Map([
      ["1", { routeName: "1", routeType: 1 }],
    ]);

    const result = aggregateStopTrips(stopTimeTripIds, trips, calendar, routes);
    const stop101 = result["101N"];
    expect(stop101).toBeDefined();
    const route1 = stop101.routes["1"];
    expect(route1.dir0WeekdayMin).toBe(2);
    expect(route1.dir0WeekendMax).toBe(1);
  });
});

describe("mergeNSPlatforms", () => {
  it("merges N and S platforms into a single station with both directions", () => {
    const raw: StopTripsIndex = {
      "120N": {
        stopName: "96 St",
        lat: 40.7936,
        lng: -73.9722,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 231,
            dir0WeekendMax: 186,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        },
      },
      "120S": {
        stopName: "96 St",
        lat: 40.7934,
        lng: -73.9723,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [1],
            dir0WeekdayMin: 0,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 231,
            dir1WeekendMax: 186,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);

    expect(Object.keys(merged)).toEqual(["120"]);
    expect(merged["120"].stopName).toBe("96 St");
    expect(merged["120"].lat).toBe(40.7936);
    expect(merged["120"].lng).toBe(-73.9722);
    expect(merged["120"].routes["1"].directions).toEqual([0, 1]);
    expect(merged["120"].routes["1"].dir0WeekdayMin).toBe(231);
    expect(merged["120"].routes["1"].dir1WeekdayMin).toBe(231);
    expect(merged["120"].routes["1"].dir0WeekendMax).toBe(186);
    expect(merged["120"].routes["1"].dir1WeekendMax).toBe(186);
  });

  it("handles unpaired N-only station and keeps single direction", () => {
    const raw: StopTripsIndex = {
      "711N": {
        stopName: "69 St",
        lat: 40.123,
        lng: -73.456,
        routes: {
          R: {
            routeName: "R",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 100,
            dir0WeekendMax: 80,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);

    expect(Object.keys(merged)).toEqual(["711"]);
    expect(merged["711"].routes.R.directions).toEqual([0]);
    expect(merged["711"].routes.R.dir0WeekdayMin).toBe(100);
  });

  it("falls back to S platform when N platform is absent", () => {
    const raw: StopTripsIndex = {
      "712S": {
        stopName: "S-Only Stop",
        lat: 40.124,
        lng: -73.457,
        routes: {
          T: {
            routeName: "T",
            routeType: 1,
            directions: [1],
            dir0WeekdayMin: 0,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 88,
            dir1WeekendMax: 66,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);

    expect(Object.keys(merged)).toEqual(["712"]);
    expect(merged["712"].stopName).toBe("S-Only Stop");
    expect(merged["712"].routes.T.directions).toEqual([1]);
    expect(merged["712"].routes.T.dir1WeekdayMin).toBe(88);
  });

  it("merges multi-route station correctly", () => {
    const raw: StopTripsIndex = {
      "100N": {
        stopName: "Times Sq",
        lat: 40.756,
        lng: -73.987,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 200,
            dir0WeekendMax: 150,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
          N: {
            routeName: "N",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 180,
            dir0WeekendMax: 120,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        },
      },
      "100S": {
        stopName: "Times Sq",
        lat: 40.7559,
        lng: -73.9869,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [1],
            dir0WeekdayMin: 0,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 195,
            dir1WeekendMax: 145,
          },
          Q: {
            routeName: "Q",
            routeType: 1,
            directions: [1],
            dir0WeekdayMin: 0,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 160,
            dir1WeekendMax: 100,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);
    const station = merged["100"];

    expect(Object.keys(merged)).toEqual(["100"]);
    expect(station.routes["1"].directions).toEqual([0, 1]);
    expect(station.routes["1"].dir0WeekdayMin).toBe(200);
    expect(station.routes["1"].dir1WeekdayMin).toBe(195);
    expect(station.routes.N.directions).toEqual([0]);
    expect(station.routes.Q.directions).toEqual([1]);
  });

  it("passes through stops without N/S suffix unchanged", () => {
    const raw: StopTripsIndex = {
      MISC: {
        stopName: "Special Stop",
        lat: 40,
        lng: -73,
        routes: {},
      },
    };

    const merged = mergeNSPlatforms(raw);

    expect(merged.MISC).toBeDefined();
    expect(merged.MISC.stopName).toBe("Special Stop");
    expect(Object.keys(merged)).toEqual(["MISC"]);
  });

  it("preserves passthrough routes when an unsuffixed stop coexists with N/S platforms", () => {
    const raw: StopTripsIndex = {
      "555": {
        stopName: "Complex Station",
        lat: 40.5,
        lng: -73.5,
        routes: {
          X: {
            routeName: "X",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 42,
            dir0WeekendMax: 30,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        },
      },
      "555N": {
        stopName: "Complex Station N",
        lat: 40.5001,
        lng: -73.5001,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [0],
            dir0WeekdayMin: 111,
            dir0WeekendMax: 90,
            dir1WeekdayMin: 0,
            dir1WeekendMax: 0,
          },
        },
      },
      "555S": {
        stopName: "Complex Station S",
        lat: 40.4999,
        lng: -73.4999,
        routes: {
          "1": {
            routeName: "1",
            routeType: 1,
            directions: [1],
            dir0WeekdayMin: 0,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 112,
            dir1WeekendMax: 91,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);

    expect(Object.keys(merged)).toEqual(["555"]);
    expect(merged["555"].stopName).toBe("Complex Station N");
    expect(merged["555"].routes["1"].directions).toEqual([0, 1]);
    expect(merged["555"].routes["1"].dir0WeekdayMin).toBe(111);
    expect(merged["555"].routes["1"].dir1WeekdayMin).toBe(112);
    expect(merged["555"].routes.X.directions).toEqual([0]);
    expect(merged["555"].routes.X.dir0WeekdayMin).toBe(42);
  });
});
