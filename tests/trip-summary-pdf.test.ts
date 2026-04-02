import { describe, it, expect } from "vitest";
import { generateTripSummaryPdf } from "@/lib/trip-summary-pdf";
import type { TransitStation } from "@/lib/transit-types";

function makeStation(overrides: Partial<TransitStation> = {}): TransitStation {
  return {
    stopId: "101",
    name: "57 St - 7 Av",
    location: { lat: 40.7641, lng: -73.9773 },
    walkingDistanceMi: 0.15,
    stationType: "subway",
    routes: [
      {
        routeId: "N",
        routeName: "N",
        routeType: 1,
        weekdayTrips: 120,
        weekendTrips: 85,
        counted: true,
      },
    ],
    ...overrides,
  };
}

describe("generateTripSummaryPdf", () => {
  it("returns a Buffer containing a valid PDF", async () => {
    const buffer = await generateTripSummaryPdf({
      address: "7th Ave & Central Park S, New York, NY 10019",
      qualifyingStations: [makeStation()],
      totalWeekdayTrips: 120,
      totalWeekendTrips: 85,
      transitScore: 1,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    // PDF magic bytes
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles multiple stations", async () => {
    const stations = [
      makeStation({ stopId: "101", name: "57 St" }),
      makeStation({
        stopId: "201",
        name: "59 St - Columbus",
        walkingDistanceMi: 0.32,
        routes: [
          {
            routeId: "A",
            routeName: "A",
            routeType: 1,
            weekdayTrips: 78,
            weekendTrips: 52,
            counted: true,
          },
        ],
      }),
    ];

    const buffer = await generateTripSummaryPdf({
      address: "7th Ave & Central Park S, New York, NY 10019",
      qualifyingStations: stations,
      totalWeekdayTrips: 198,
      totalWeekendTrips: 137,
      transitScore: 2,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles zero qualifying stations", async () => {
    const buffer = await generateTripSummaryPdf({
      address: "Remote Location, NY",
      qualifyingStations: [],
      totalWeekdayTrips: 0,
      totalWeekendTrips: 0,
      transitScore: 0,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
