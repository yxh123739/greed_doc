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
