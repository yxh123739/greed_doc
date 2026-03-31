# LTc3 Transit Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder transit trip counts with real GTFS-based weekday/weekend trip calculations and LEED scoring (0-4 points) on both the transit page and benchmark summary.

**Architecture:** A preprocess script converts raw GTFS files into a compact JSON index keyed by stop_id. The transit API loads this index, finds nearby stops via haversine distance, applies LEED counting rules (paired service, single-direction, one-stop-per-route dedup), and returns trip totals + score. Both the transit page and benchmark page consume this API response.

**Tech Stack:** TypeScript, Node.js (tsx for scripts), Next.js API routes, Vitest for testing, existing haversine utility in `lib/google-maps.ts`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/transit-types.ts` | Create | Shared types: StopTripsIndex, RouteTrips, TransitScoreResult, updated TransitStation, TransitApiResponse |
| `lib/transit-scoring.ts` | Create | Pure scoring functions: distance filtering, paired-service check, direction min, route dedup, threshold scoring |
| `scripts/preprocess-gtfs.ts` | Create | GTFS CSV → stop-trips.json index |
| `tests/transit-scoring.test.ts` | Create | Unit tests for scoring logic |
| `tests/preprocess-gtfs.test.ts` | Create | Unit tests for preprocess helpers |
| `app/api/transit/route.ts` | Modify | Replace Google Places with GTFS index lookup + scoring |
| `app/benchmark/transit/page.tsx` | Modify | Show trips, points, route-level breakdown |
| `app/benchmark/page.tsx` | Modify | Integrate transit score into LTc3 Option 2, add to total |
| `lib/google-maps.ts` | Modify | Remove old TransitStation/TransitApiResponse (moved to transit-types.ts), keep haversine + constants |
| `package.json` | Modify | Add `preprocess-gtfs` script |

---

### Task 1: Create Shared Types (`lib/transit-types.ts`)

**Files:**
- Create: `lib/transit-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// lib/transit-types.ts

// --- GTFS Index Types (output of preprocess script) ---

export interface StopRouteData {
  routeName: string;
  routeType: number;
  directions: number[];
  dir0WeekdayMin: number;
  dir0WeekendMax: number;
  dir1WeekdayMin: number;
  dir1WeekendMax: number;
}

export interface StopData {
  stopName: string;
  lat: number;
  lng: number;
  parentStation: string;
  routes: Record<string, StopRouteData>;
}

export type StopTripsIndex = Record<string, StopData>;

// --- API Response Types ---

export type StationType = "bus" | "subway";

export interface RouteTrips {
  routeId: string;
  routeName: string;
  routeType: number;
  weekdayTrips: number;
  weekendTrips: number;
  counted: boolean;
}

export interface TransitStation {
  stopId: string;
  name: string;
  location: { lat: number; lng: number };
  walkingDistanceMi: number;
  stationType: StationType;
  routes: RouteTrips[];
}

export interface TransitApiResponse {
  stations: TransitStation[];
  geocodedLocation: { lat: number; lng: number };
  address: string;
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}

// --- Scoring Types ---

export interface QualifyingRoute {
  routeId: string;
  routeName: string;
  routeType: number;
  stopId: string;
  stopName: string;
  weekdayTrips: number;
  weekendTrips: number;
}

export interface TransitScoreResult {
  qualifyingRoutes: QualifyingRoute[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  points: number;
  threshold: { weekday: number; weekend: number } | null;
}

// --- Constants ---

export const TRANSIT_THRESHOLDS = [
  { weekday: 360, weekend: 216, points: 4 },
  { weekday: 160, weekend: 120, points: 3 },
  { weekday: 132, weekend: 78, points: 2 },
  { weekday: 72, weekend: 30, points: 1 },
] as const;

/**
 * Max walking distance in miles by GTFS route_type.
 * route_type 3 (bus) and 0 (streetcar) = 0.25 mi; everything else = 0.5 mi.
 */
export function maxDistanceForRouteType(routeType: number): number {
  return routeType === 3 || routeType === 0 ? 0.25 : 0.5;
}

/**
 * Map GTFS route_type to display StationType.
 */
export function stationTypeFromRouteType(routeType: number): StationType {
  return routeType === 3 || routeType === 0 ? "bus" : "subway";
}
```

- [ ] **Step 2: Update `lib/google-maps.ts` — remove moved types**

Replace the entire file with:

```typescript
// lib/google-maps.ts
// Radius constants for LEED v5 LTc3 transit proximity circles
export const QUARTER_MILE_METERS = 402.336; // 0.25 mi
export const HALF_MILE_METERS = 804.672; // 0.5 mi

/**
 * Haversine formula: calculate the great-circle distance between two points.
 * Returns distance in miles.
 */
export function haversineDistanceMi(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const aVal =
    sinHalfLat * sinHalfLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinHalfLng *
      sinHalfLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in files that still import old types from `google-maps.ts` — this is expected and will be fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
git add lib/transit-types.ts lib/google-maps.ts
git commit -m "feat: create transit-types.ts with GTFS index and scoring types"
```

---

### Task 2: Implement Transit Scoring Logic (`lib/transit-scoring.ts`)

**Files:**
- Create: `tests/transit-scoring.test.ts`
- Create: `lib/transit-scoring.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/transit-scoring.test.ts
import { describe, it, expect } from "vitest";
import {
  calculateTransitScore,
  findNearbyGtfsStops,
  computeRouteTrips,
  deduplicateRoutes,
} from "@/lib/transit-scoring";
import type { StopTripsIndex, StopData } from "@/lib/transit-types";

// --- Test fixtures ---

/** A subway stop with route 1 running both directions */
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
    const center = { lat: 40.767, lng: -73.981 }; // ~0.1 mi away
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(1);
    expect(result[0].stopId).toBe("101N");
  });

  it("excludes subway stops beyond 0.5 mi", () => {
    const index: StopTripsIndex = {
      "101N": makeSubwayStop({ lat: 40.780, lng: -73.982 }), // ~0.83 mi away
    };
    const center = { lat: 40.768, lng: -73.982 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(0);
  });

  it("excludes bus stops beyond 0.25 mi", () => {
    const index: StopTripsIndex = {
      "B1": {
        stopName: "Bus Stop",
        lat: 40.771,
        lng: -73.982,
        parentStation: "",
        routes: {
          M5: {
            routeName: "M5",
            routeType: 3, // bus
            directions: [0, 1],
            dir0WeekdayMin: 60,
            dir0WeekendMax: 0,
            dir1WeekdayMin: 60,
            dir1WeekendMax: 0,
          },
        },
      },
    };
    const center = { lat: 40.768, lng: -73.982 }; // ~0.21 mi away
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/transit-scoring.test.ts 2>&1 | tail -20`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the scoring module**

```typescript
// lib/transit-scoring.ts
import { haversineDistanceMi } from "@/lib/google-maps";
import {
  TRANSIT_THRESHOLDS,
  maxDistanceForRouteType,
  stationTypeFromRouteType,
  type StopTripsIndex,
  type StopRouteData,
  type QualifyingRoute,
  type TransitScoreResult,
  type TransitStation,
  type RouteTrips,
} from "@/lib/transit-types";

// --- Threshold scoring ---

export function calculateTransitScore(
  totalWeekday: number,
  totalWeekend: number
): { points: number; threshold: { weekday: number; weekend: number } | null } {
  for (const t of TRANSIT_THRESHOLDS) {
    if (totalWeekday >= t.weekday && totalWeekend >= t.weekend) {
      return { points: t.points, threshold: { weekday: t.weekday, weekend: t.weekend } };
    }
  }
  return { points: 0, threshold: null };
}

// --- Paired-service & direction-min ---

export function computeRouteTrips(
  route: StopRouteData
): { weekdayTrips: number; weekendTrips: number } | null {
  // Rule 1: must have both directions
  if (!route.directions.includes(0) || !route.directions.includes(1)) {
    return null;
  }
  // Rule 2: take the direction with fewer trips
  const weekdayTrips = Math.min(route.dir0WeekdayMin, route.dir1WeekdayMin);
  const weekendTrips = Math.min(route.dir0WeekendMax, route.dir1WeekendMax);
  return { weekdayTrips, weekendTrips };
}

// --- Nearby stop finding ---

interface NearbyStop {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  distanceMi: number;
  dominantRouteType: number;
  routes: Record<string, StopRouteData>;
}

export function findNearbyGtfsStops(
  index: StopTripsIndex,
  center: { lat: number; lng: number }
): NearbyStop[] {
  const results: NearbyStop[] = [];

  for (const [stopId, stop] of Object.entries(index)) {
    const stopLoc = { lat: stop.lat, lng: stop.lng };
    const distMi = haversineDistanceMi(center, stopLoc);

    // Determine max allowed distance from the stop's route types.
    // A stop can serve multiple routes of different types. Use the most
    // permissive (largest) distance threshold among its routes.
    const routeEntries = Object.values(stop.routes);
    if (routeEntries.length === 0) continue;

    const maxAllowed = Math.max(
      ...routeEntries.map((r) => maxDistanceForRouteType(r.routeType))
    );

    if (distMi > maxAllowed) continue;

    // Dominant route type: use the one with the most generous distance
    // (prefer subway/rail over bus when a stop serves both).
    const dominantRouteType = routeEntries.reduce((best, r) =>
      maxDistanceForRouteType(r.routeType) > maxDistanceForRouteType(best.routeType) ? r : best
    ).routeType;

    results.push({
      stopId,
      stopName: stop.stopName,
      lat: stop.lat,
      lng: stop.lng,
      distanceMi: Math.round(distMi * 100) / 100,
      dominantRouteType,
      routes: stop.routes,
    });
  }

  return results.sort((a, b) => a.distanceMi - b.distanceMi);
}

// --- Route deduplication ---

export function deduplicateRoutes(
  candidates: QualifyingRoute[]
): QualifyingRoute[] {
  // Rule 3: same routeId at multiple stops → keep stop with highest weekdayTrips
  const bestByRoute = new Map<string, QualifyingRoute>();
  for (const c of candidates) {
    const existing = bestByRoute.get(c.routeId);
    if (!existing || c.weekdayTrips > existing.weekdayTrips) {
      bestByRoute.set(c.routeId, c);
    }
  }
  return Array.from(bestByRoute.values());
}

// --- Full scoring pipeline ---

export function scoreTransit(
  index: StopTripsIndex,
  center: { lat: number; lng: number }
): TransitScoreResult {
  const nearbyStops = findNearbyGtfsStops(index, center);

  // Build all qualifying route candidates
  const allCandidates: QualifyingRoute[] = [];
  for (const stop of nearbyStops) {
    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      // Per-route distance check: a bus route at a subway stop still uses 0.25 mi
      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (stop.distanceMi > routeMaxDist) continue;

      const trips = computeRouteTrips(routeData);
      if (!trips) continue; // no paired service

      allCandidates.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        stopId: stop.stopId,
        stopName: stop.stopName,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
      });
    }
  }

  const qualifyingRoutes = deduplicateRoutes(allCandidates);
  const totalWeekdayTrips = qualifyingRoutes.reduce((s, r) => s + r.weekdayTrips, 0);
  const totalWeekendTrips = qualifyingRoutes.reduce((s, r) => s + r.weekendTrips, 0);
  const { points, threshold } = calculateTransitScore(totalWeekdayTrips, totalWeekendTrips);

  return { qualifyingRoutes, totalWeekdayTrips, totalWeekendTrips, points, threshold };
}

// --- Build TransitStation[] for API response ---

export function buildStationResponse(
  index: StopTripsIndex,
  center: { lat: number; lng: number },
  scoreResult: TransitScoreResult
): TransitStation[] {
  const nearbyStops = findNearbyGtfsStops(index, center);
  const countedSet = new Set(
    scoreResult.qualifyingRoutes.map((r) => `${r.routeId}::${r.stopId}`)
  );

  return nearbyStops.map((stop) => {
    const routeTrips: RouteTrips[] = [];
    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (stop.distanceMi > routeMaxDist) continue;

      const trips = computeRouteTrips(routeData);
      if (!trips) continue;

      routeTrips.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
        counted: countedSet.has(`${routeId}::${stop.stopId}`),
      });
    }

    return {
      stopId: stop.stopId,
      name: stop.stopName,
      location: { lat: stop.lat, lng: stop.lng },
      walkingDistanceMi: stop.distanceMi,
      stationType: stationTypeFromRouteType(stop.dominantRouteType),
      routes: routeTrips,
    };
  }).filter((s) => s.routes.length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/transit-scoring.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/transit-scoring.ts tests/transit-scoring.test.ts
git commit -m "feat: implement LEED transit scoring with TDD"
```

---

### Task 3: Create GTFS Preprocess Script (`scripts/preprocess-gtfs.ts`)

**Files:**
- Create: `tests/preprocess-gtfs.test.ts`
- Create: `scripts/preprocess-gtfs.ts`
- Modify: `package.json`

- [ ] **Step 1: Write tests for the CSV parsing helpers**

```typescript
// tests/preprocess-gtfs.test.ts
import { describe, it, expect } from "vitest";
import {
  parseCalendar,
  parseRoutes,
  parseTrips,
  aggregateStopTrips,
} from "@/scripts/preprocess-gtfs";

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
    // T1 and T2 stop at 101N, T3 also stops at 101N
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
    expect(route1.dir0WeekdayMin).toBe(2); // 2 weekday trips, same count all days since only one service
    expect(route1.dir0WeekendMax).toBe(1); // 1 saturday trip
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/preprocess-gtfs.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the preprocess script**

```typescript
// scripts/preprocess-gtfs.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { StopTripsIndex, StopRouteData } from "@/lib/transit-types";

const GTFS_DIR = path.resolve("public/gtfs_supplemented");
const OUTPUT_DIR = path.resolve(GTFS_DIR, "index");
const OUTPUT_FILE = path.resolve(OUTPUT_DIR, "stop-trips.json");

// --- CSV Helpers ---

function parseCsvLines(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h.trim()] = (values[i] ?? "").trim();
    });
    return record;
  });
}

// --- Exported Parsers (for testing) ---

export interface DayFlags {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

export function parseCalendar(csv: string): Map<string, DayFlags> {
  const map = new Map<string, DayFlags>();
  for (const row of parseCsvLines(csv)) {
    map.set(row.service_id, {
      monday: row.monday === "1",
      tuesday: row.tuesday === "1",
      wednesday: row.wednesday === "1",
      thursday: row.thursday === "1",
      friday: row.friday === "1",
      saturday: row.saturday === "1",
      sunday: row.sunday === "1",
    });
  }
  return map;
}

export function parseRoutes(
  csv: string
): Map<string, { routeName: string; routeType: number }> {
  const map = new Map<string, { routeName: string; routeType: number }>();
  for (const row of parseCsvLines(csv)) {
    map.set(row.route_id, {
      routeName: row.route_short_name || row.route_id,
      routeType: parseInt(row.route_type, 10),
    });
  }
  return map;
}

export interface TripInfo {
  routeId: string;
  serviceId: string;
  directionId: number;
}

export function parseTrips(csv: string): Map<string, TripInfo> {
  const map = new Map<string, TripInfo>();
  for (const row of parseCsvLines(csv)) {
    map.set(row.trip_id, {
      routeId: row.route_id,
      serviceId: row.service_id,
      directionId: parseInt(row.direction_id, 10),
    });
  }
  return map;
}

function parseStops(csv: string): Map<
  string,
  { stopName: string; lat: number; lng: number; locationType: string; parentStation: string }
> {
  const map = new Map();
  for (const row of parseCsvLines(csv)) {
    map.set(row.stop_id, {
      stopName: row.stop_name,
      lat: parseFloat(row.stop_lat),
      lng: parseFloat(row.stop_lon),
      locationType: row.location_type || "",
      parentStation: row.parent_station || "",
    });
  }
  return map;
}

// --- Aggregation ---

export function aggregateStopTrips(
  stopTimeTripIds: Map<string, Set<string>>,
  trips: Map<string, TripInfo>,
  calendar: Map<string, DayFlags>,
  routes: Map<string, { routeName: string; routeType: number }>
): Record<string, { routes: Record<string, StopRouteData> }> {
  const result: Record<string, { routes: Record<string, StopRouteData> }> = {};

  for (const [stopId, tripIdSet] of stopTimeTripIds.entries()) {
    // Group by routeId + directionId + serviceId
    const groups = new Map<string, number>(); // key: routeId|directionId|serviceId → count

    for (const tripId of tripIdSet) {
      const trip = trips.get(tripId);
      if (!trip) continue;
      const key = `${trip.routeId}|${trip.directionId}|${trip.serviceId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    // Aggregate into per-route, per-direction, per-day-type
    const routeAgg: Record<string, {
      dirs: Record<number, { weekdayPerDay: number[]; weekendPerDay: number[] }>;
    }> = {};

    for (const [key, count] of groups.entries()) {
      const [routeId, dirStr, serviceId] = key.split("|");
      const dir = parseInt(dirStr, 10);
      const svc = calendar.get(serviceId);
      if (!svc) continue;

      if (!routeAgg[routeId]) routeAgg[routeId] = { dirs: {} };
      if (!routeAgg[routeId].dirs[dir]) {
        routeAgg[routeId].dirs[dir] = { weekdayPerDay: [0, 0, 0, 0, 0], weekendPerDay: [0, 0] };
      }
      const d = routeAgg[routeId].dirs[dir];

      // Distribute trip count to applicable days
      const weekdays = [svc.monday, svc.tuesday, svc.wednesday, svc.thursday, svc.friday];
      weekdays.forEach((active, i) => { if (active) d.weekdayPerDay[i] += count; });
      if (svc.saturday) d.weekendPerDay[0] += count;
      if (svc.sunday) d.weekendPerDay[1] += count;
    }

    // Build StopRouteData
    const stopRoutes: Record<string, StopRouteData> = {};
    for (const [routeId, agg] of Object.entries(routeAgg)) {
      const routeInfo = routes.get(routeId);
      if (!routeInfo) continue;

      const directions = Object.keys(agg.dirs).map(Number).sort();
      const dir0 = agg.dirs[0];
      const dir1 = agg.dirs[1];

      stopRoutes[routeId] = {
        routeName: routeInfo.routeName,
        routeType: routeInfo.routeType,
        directions,
        dir0WeekdayMin: dir0 ? Math.min(...dir0.weekdayPerDay) : 0,
        dir0WeekendMax: dir0 ? Math.max(...dir0.weekendPerDay) : 0,
        dir1WeekdayMin: dir1 ? Math.min(...dir1.weekdayPerDay) : 0,
        dir1WeekendMax: dir1 ? Math.max(...dir1.weekendPerDay) : 0,
      };
    }

    if (Object.keys(stopRoutes).length > 0) {
      result[stopId] = { routes: stopRoutes };
    }
  }

  return result;
}

// --- Stream stop_times.txt ---

async function streamStopTimes(
  filePath: string,
  trips: Map<string, TripInfo>
): Promise<Map<string, Set<string>>> {
  const stopTrips = new Map<string, Set<string>>();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let isHeader = true;
  let tripIdCol = 0;
  let stopIdCol = 1;

  for await (const line of rl) {
    if (isHeader) {
      const headers = line.split(",").map((h) => h.trim());
      tripIdCol = headers.indexOf("trip_id");
      stopIdCol = headers.indexOf("stop_id");
      isHeader = false;
      continue;
    }

    const parts = line.split(",");
    const tripId = parts[tripIdCol]?.trim();
    const stopId = parts[stopIdCol]?.trim();

    if (!tripId || !stopId) continue;
    if (!trips.has(tripId)) continue; // skip unknown trips

    let set = stopTrips.get(stopId);
    if (!set) {
      set = new Set();
      stopTrips.set(stopId, set);
    }
    set.add(tripId);
  }

  return stopTrips;
}

// --- Main entry point ---

async function main() {
  console.log("Preprocessing GTFS data...");

  const calendarCsv = fs.readFileSync(path.join(GTFS_DIR, "calendar.txt"), "utf-8");
  const routesCsv = fs.readFileSync(path.join(GTFS_DIR, "routes.txt"), "utf-8");
  const tripsCsv = fs.readFileSync(path.join(GTFS_DIR, "trips.txt"), "utf-8");
  const stopsCsv = fs.readFileSync(path.join(GTFS_DIR, "stops.txt"), "utf-8");

  const calendar = parseCalendar(calendarCsv);
  console.log(`  calendar.txt: ${calendar.size} services`);

  const routes = parseRoutes(routesCsv);
  console.log(`  routes.txt: ${routes.size} routes`);

  const trips = parseTrips(tripsCsv);
  console.log(`  trips.txt: ${trips.size} trips`);

  const stops = parseStops(stopsCsv);
  console.log(`  stops.txt: ${stops.size} stops`);

  console.log("  Streaming stop_times.txt...");
  const stopTimeTripIds = await streamStopTimes(
    path.join(GTFS_DIR, "stop_times.txt"),
    trips
  );
  console.log(`  stop_times.txt: ${stopTimeTripIds.size} stops with trips`);

  console.log("  Aggregating...");
  const rawAgg = aggregateStopTrips(stopTimeTripIds, trips, calendar, routes);

  // Merge with stop geo data, exclude parent stations (location_type === "1")
  const index: StopTripsIndex = {};
  for (const [stopId, data] of Object.entries(rawAgg)) {
    const stopInfo = stops.get(stopId);
    if (!stopInfo) continue;
    if (stopInfo.locationType === "1") continue; // parent station, skip

    index[stopId] = {
      stopName: stopInfo.stopName,
      lat: stopInfo.lat,
      lng: stopInfo.lng,
      parentStation: stopInfo.parentStation,
      routes: data.routes,
    };
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index));

  const stopCount = Object.keys(index).length;
  const routeCount = new Set(
    Object.values(index).flatMap((s) => Object.keys(s.routes))
  ).size;
  const fileSizeMb = (Buffer.byteLength(JSON.stringify(index)) / 1024 / 1024).toFixed(1);

  console.log(`\nDone! Wrote ${OUTPUT_FILE}`);
  console.log(`  ${stopCount} stops, ${routeCount} routes, ${fileSizeMb} MB`);
}

// Run if executed directly (not imported for testing)
const isDirectRun = process.argv[1]?.endsWith("preprocess-gtfs.ts") ||
                    process.argv[1]?.endsWith("preprocess-gtfs");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Preprocess failed:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/preprocess-gtfs.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Add npm script to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"preprocess-gtfs": "tsx scripts/preprocess-gtfs.ts"
```

- [ ] **Step 6: Run the preprocess script against real data**

Run: `npx tsx scripts/preprocess-gtfs.ts`
Expected output (approximate):
```
Preprocessing GTFS data...
  calendar.txt: 78 services
  routes.txt: 29 routes
  trips.txt: 81806 trips
  stops.txt: 1488 stops
  Streaming stop_times.txt...
  ...
Done! Wrote public/gtfs_supplemented/index/stop-trips.json
  ~940 stops, 29 routes, ~X.X MB
```

- [ ] **Step 7: Verify the output JSON structure**

Run: `node -e "const d=require('./public/gtfs_supplemented/index/stop-trips.json'); const k=Object.keys(d); console.log('stops:', k.length); const s=d[k[0]]; console.log('sample:', JSON.stringify(s, null, 2).slice(0,500))"`
Expected: Shows a valid stop with routes, directions, weekday/weekend counts

- [ ] **Step 8: Add index to .gitignore**

Add this line to `.gitignore`:
```
public/gtfs_supplemented/index/
```

- [ ] **Step 9: Commit**

```bash
git add scripts/preprocess-gtfs.ts tests/preprocess-gtfs.test.ts package.json .gitignore
git commit -m "feat: add GTFS preprocess script with streaming stop_times parser"
```

---

### Task 4: Update Transit API Route (`app/api/transit/route.ts`)

**Files:**
- Modify: `app/api/transit/route.ts`

- [ ] **Step 1: Rewrite the transit API route**

Replace the entire file with:

```typescript
// app/api/transit/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { haversineDistanceMi } from "@/lib/google-maps";
import { scoreTransit, buildStationResponse } from "@/lib/transit-scoring";
import type { StopTripsIndex, TransitApiResponse } from "@/lib/transit-types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// --- Load GTFS index (cached at module level) ---

let gtfsIndex: StopTripsIndex | null = null;

function loadGtfsIndex(): StopTripsIndex {
  if (gtfsIndex) return gtfsIndex;

  const indexPath = path.resolve("public/gtfs_supplemented/index/stop-trips.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      "GTFS index not found. Run `pnpm run preprocess-gtfs` first."
    );
  }

  const raw = fs.readFileSync(indexPath, "utf-8");
  gtfsIndex = JSON.parse(raw) as StopTripsIndex;
  return gtfsIndex;
}

// --- Geocoding (kept from original) ---

type TransitPayload = {
  address?: string;
  city?: string;
  stateProvince?: string;
  zipCode?: string;
  country?: string;
};

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function geocodeAddress(
  fullAddress: string,
  signal: AbortSignal
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    fullAddress
  )}&key=${API_KEY}`;

  const res = await fetchWithRetry(url, { signal });
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.length) return null;
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

// --- Main handler ---

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key is not configured." },
      { status: 500 }
    );
  }

  try {
    // Load GTFS index
    let index: StopTripsIndex;
    try {
      index = loadGtfsIndex();
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 500 }
      );
    }

    const payload = (await req.json()) as TransitPayload;

    const address = payload.address?.trim() ?? "";
    const city = payload.city?.trim() ?? "";
    const stateProvince = payload.stateProvince?.trim() ?? "";
    const zipCode = payload.zipCode?.trim() ?? "";
    const country = payload.country?.trim() ?? "";

    if (!address || !city) {
      return NextResponse.json(
        { error: "Address and city are required." },
        { status: 400 }
      );
    }

    const fullAddress = [address, city, stateProvince, zipCode, country]
      .filter(Boolean)
      .join(", ");

    const signal = AbortSignal.timeout(30_000);

    // 1. Geocode
    const location = await geocodeAddress(fullAddress, signal);
    if (!location) {
      return NextResponse.json(
        { error: "Could not geocode this address. Please check and try again." },
        { status: 404 }
      );
    }

    // 2. Score transit using GTFS index
    const scoreResult = scoreTransit(index, location);

    // 3. Build station list for frontend
    const stations = buildStationResponse(index, location, scoreResult);

    const response: TransitApiResponse = {
      stations,
      geocodedLocation: location,
      address: fullAddress,
      totalWeekdayTrips: scoreResult.totalWeekdayTrips,
      totalWeekendTrips: scoreResult.totalWeekendTrips,
      transitScore: scoreResult.points,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Transit API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transit data." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors only in the two UI files (transit page and benchmark page) which still import old types. The API route should compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add app/api/transit/route.ts
git commit -m "feat: replace Google Places with GTFS-based transit scoring in API"
```

---

### Task 5: Update Transit Page (`app/benchmark/transit/page.tsx`)

**Files:**
- Modify: `app/benchmark/transit/page.tsx`

- [ ] **Step 1: Rewrite the transit page**

Replace the entire file content:

```typescript
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Circle,
  useMap,
  useMapsLibrary,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { Bus, TrainFront, MapPin, Loader2, ChevronDown } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  QUARTER_MILE_METERS,
  HALF_MILE_METERS,
} from "@/lib/google-maps";
import type {
  TransitStation,
  TransitApiResponse,
  RouteTrips,
} from "@/lib/transit-types";
import { TRANSIT_THRESHOLDS } from "@/lib/transit-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const DEFAULT_ZOOM = 15;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Legend overlay (top-right of the map) */
function MapLegend() {
  return (
    <div className="absolute right-3 top-3 z-10 rounded-2xl bg-white px-4 py-3 shadow-md">
      <div className="flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 bg-primary" />
        0.25 mi (Bus)
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 border-t-2 border-dashed border-primary" />
        0.5 mi (Subway)
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />
        Bus
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-purple-600" />
        Subway
      </div>
    </div>
  );
}

/** Distance label rendered at the midpoint between project and station */
function DistanceLabel({
  from,
  to,
  distanceMi,
}: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  distanceMi: number;
}) {
  const midpoint = useMemo(
    () => ({
      lat: (from.lat + to.lat) / 2,
      lng: (from.lng + to.lng) / 2,
    }),
    [from, to]
  );

  return (
    <AdvancedMarker position={midpoint} clickable={false}>
      <div className="rounded bg-white px-1.5 py-0.5 text-xs font-bold text-[#4285f4] shadow-sm whitespace-nowrap">
        {distanceMi.toFixed(2)} mi
      </div>
    </AdvancedMarker>
  );
}

/** Station marker with click-to-show info */
function StationMarker({ station }: { station: TransitStation }) {
  const [open, setOpen] = useState(false);
  const isSubway = station.stationType === "subway";
  const Icon = isSubway ? TrainFront : Bus;
  const bgColor = isSubway ? "bg-purple-600" : "bg-orange-500";

  return (
    <>
      <AdvancedMarker
        position={station.location}
        onClick={() => setOpen((v) => !v)}
        title={station.name}
      >
        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${bgColor} shadow-md`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </AdvancedMarker>

      {open && (
        <InfoWindow
          position={station.location}
          onCloseClick={() => setOpen(false)}
        >
          <div className="max-w-[260px] space-y-1 p-1">
            <p className="text-sm font-bold">{station.name}</p>
            <p className="text-xs text-muted-foreground">
              {station.walkingDistanceMi.toFixed(2)} mi walking
            </p>
            {station.routes.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {station.routes.map((r: RouteTrips) => (
                  <div key={r.routeId} className="flex items-center gap-1.5 text-[10px]">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-bold text-white ${r.counted ? "bg-blue-600" : "bg-gray-400"}`}>
                      {r.routeName}
                    </span>
                    <span className={r.counted ? "" : "text-muted-foreground line-through"}>
                      {r.weekdayTrips}wd / {r.weekendTrips}we
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

/** Route badges shown near each station on the map */
function StationRouteBadges({ station }: { station: TransitStation }) {
  if (station.routes.length === 0) return null;

  const badgePos = {
    lat: station.location.lat - 0.0003,
    lng: station.location.lng,
  };

  return (
    <AdvancedMarker position={badgePos} clickable={false}>
      <div className="flex gap-0.5">
        {station.routes.slice(0, 4).map((r: RouteTrips) => (
          <span
            key={r.routeId}
            className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow ${r.counted ? "bg-blue-600" : "bg-gray-400"}`}
          >
            {r.routeName}
          </span>
        ))}
      </div>
    </AdvancedMarker>
  );
}

/** Auto-fit map bounds to show all markers */
function MapBoundsFitter({
  center,
  stations,
}: {
  center: { lat: number; lng: number };
  stations: TransitStation[];
}) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !coreLib) return;
    if (stations.length === 0) {
      map.setCenter(center);
      map.setZoom(DEFAULT_ZOOM);
      return;
    }
    const bounds = new coreLib.LatLngBounds();
    bounds.extend(center);
    stations.forEach((s) => bounds.extend(s.location));
    map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  }, [map, coreLib, center, stations]);

  return null;
}

// ---------------------------------------------------------------------------
// Transit Map (main map component)
// ---------------------------------------------------------------------------

function TransitMap({
  center,
  stations,
}: {
  center: { lat: number; lng: number };
  stations: TransitStation[];
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-[#DEE2E6] shadow-sm">
      <div className="h-[400px] sm:h-[500px] lg:h-[580px]">
        <Map
          defaultCenter={center}
          defaultZoom={DEFAULT_ZOOM}
          mapId="transit-map"
          gestureHandling="greedy"
          disableDefaultUI={false}
          className="h-full w-full"
        >
          <MapBoundsFitter center={center} stations={stations} />

          {/* 0.5 mi circle (dashed appearance via lower opacity) */}
          <Circle
            center={center}
            radius={HALF_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.5}
            fillColor="#7cb342"
            fillOpacity={0.03}
          />

          {/* 0.25 mi circle (solid) */}
          <Circle
            center={center}
            radius={QUARTER_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.9}
            fillColor="#7cb342"
            fillOpacity={0.07}
          />

          {/* Project marker */}
          <AdvancedMarker position={center} title="Project Location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 shadow-lg ring-2 ring-white">
              <MapPin className="h-5 w-5 text-white" />
            </div>
          </AdvancedMarker>

          {/* Station markers + distance labels + route badges */}
          {stations.map((station) => (
            <StationMarker key={station.stopId} station={station} />
          ))}
          {stations.map((station) => (
            <DistanceLabel
              key={`dist-${station.stopId}`}
              from={center}
              to={station.location}
              distanceMi={station.walkingDistanceMi}
            />
          ))}
          {stations.map((station) => (
            <StationRouteBadges
              key={`routes-${station.stopId}`}
              station={station}
            />
          ))}
        </Map>
      </div>
      <MapLegend />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({
  data,
}: {
  data: TransitApiResponse;
}) {
  const busCount = data.stations.filter((s) => s.stationType === "bus").length;
  const subwayCount = data.stations.filter((s) => s.stationType === "subway").length;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white px-6 py-6 text-center shadow-sm">
      <p className="text-lg text-foreground">
        <span className="font-bold">{busCount}</span>{" "}
        <span>bus stations (within 0.25 mi)</span>,{" "}
        <span className="font-bold">{subwayCount}</span>{" "}
        <span>subway stations (within 0.5 mi)</span>
      </p>
      <p className="mt-3 text-5xl font-bold text-primary">
        {data.stations.length} Transit Stops
      </p>
      <div className="mt-4 flex justify-center gap-8">
        <div>
          <p className="text-2xl font-bold text-foreground">{data.totalWeekdayTrips}</p>
          <p className="text-sm text-muted-foreground">Weekday Trips</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{data.totalWeekendTrips}</p>
          <p className="text-sm text-muted-foreground">Weekend Trips</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-primary">{data.transitScore}</p>
          <p className="text-sm text-muted-foreground">Points</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        LEED V5 BD+C, LTc3 Compact and Connected Development
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Station list panel
// ---------------------------------------------------------------------------

function StationListPanel({ stations }: { stations: TransitStation[] }) {
  const [open, setOpen] = useState(false);

  if (stations.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-primary/8 px-5 py-4 sm:px-6"
      >
        <h2 className="text-base font-bold uppercase tracking-[0.04em] text-primary sm:text-[1.15rem]">
          Nearby Transit Stations ({stations.length})
        </h2>
        <ChevronDown
          className={`h-5 w-5 text-primary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="divide-y divide-[#E9ECEF]">
          {stations.map((station) => (
            <div
              key={station.stopId}
              className="px-5 py-3 sm:px-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  {station.stationType === "subway" ? (
                    <TrainFront className="h-4 w-4 shrink-0 text-purple-600" />
                  ) : (
                    <Bus className="h-4 w-4 shrink-0 text-orange-500" />
                  )}
                  <p className="text-sm font-bold text-foreground">
                    {station.name}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-muted-foreground">
                  {station.walkingDistanceMi.toFixed(2)} mi
                </span>
              </div>
              {station.routes.length > 0 && (
                <div className="ml-6 mt-2 space-y-1">
                  {station.routes.map((r: RouteTrips) => (
                    <div
                      key={r.routeId}
                      className={`flex items-center gap-2 text-xs ${r.counted ? "" : "opacity-50"}`}
                    >
                      <span className={`inline-block rounded px-1.5 py-0.5 font-bold text-white ${r.counted ? "bg-blue-600" : "bg-gray-400"}`}>
                        {r.routeName}
                      </span>
                      <span>{r.weekdayTrips} weekday</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{r.weekendTrips} weekend</span>
                      {!r.counted && (
                        <span className="text-muted-foreground italic">(counted at other stop)</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA panel
// ---------------------------------------------------------------------------

function CtaPanel() {
  return (
    <section className="rounded-[18px] bg-primary/5 px-6 py-10 text-center">
      <h2 className="text-3xl font-bold text-foreground">
        Grab Your LEED Docs!
      </h2>
      <p className="mt-2 text-lg text-muted-foreground">
        Everything you need to claim your eligible LEED points, ready to go.
      </p>
      <Button size="lg" className="mt-6 rounded-lg px-10 text-xl font-bold">
        Download
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page content (reads search params)
// ---------------------------------------------------------------------------

function TransitPageContent() {
  const searchParams = useSearchParams();

  const address = searchParams.get("address") ?? "";
  const city = searchParams.get("city") ?? "";
  const stateProvince = searchParams.get("stateProvince") ?? "";
  const zipCode = searchParams.get("zipCode") ?? "";
  const country = searchParams.get("country") ?? "";

  const fullAddress = [address, city, stateProvince, zipCode, country]
    .filter(Boolean)
    .join(", ");

  const [data, setData] = useState<TransitApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransitData = useCallback(async () => {
    if (!address || !city) {
      setError("Address and city are required.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/transit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, city, stateProvince, zipCode, country }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `Request failed (${res.status})`
        );
      }

      const payload: TransitApiResponse = await res.json();
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load transit data."
      );
    } finally {
      setLoading(false);
    }
  }, [address, city, stateProvince, zipCode, country]);

  useEffect(() => {
    fetchTransitData();
  }, [fetchTransitData]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg text-muted-foreground">
          Analyzing transit access...
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-lg font-semibold text-destructive">
          {error ?? "No data available."}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => fetchTransitData()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1140px] space-y-8 px-4 py-8 sm:px-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          LEED v5 Access to Transit Calculator
        </h1>
        <p className="mt-2 text-base text-muted-foreground sm:text-lg">
          Type in your project address to view eligible LEED v5 credits and
          download the supporting documentation.
        </p>
      </div>

      {/* Address bar */}
      <div className="rounded-lg bg-muted px-5 py-3">
        <p className="text-sm font-medium text-foreground">{fullAddress}</p>
      </div>

      {/* Map */}
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <TransitMap center={data.geocodedLocation} stations={data.stations} />
      </APIProvider>

      {/* Results */}
      <ResultsPanel data={data} />

      {/* Station list */}
      <StationListPanel stations={data.stations} />

      {/* CTA */}
      <CtaPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (with Suspense for useSearchParams)
// ---------------------------------------------------------------------------

export default function TransitPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          }
        >
          <TransitPageContent />
        </Suspense>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Copyright &copy; 2026 Anchor Sustainability LLC. All Rights Reserved.
      </footer>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles (transit page)**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only errors from benchmark page (still uses old types). Transit page should be clean.

- [ ] **Step 3: Commit**

```bash
git add app/benchmark/transit/page.tsx
git commit -m "feat: update transit page with GTFS trip counts and LEED scoring display"
```

---

### Task 6: Update Benchmark Summary Page (`app/benchmark/page.tsx`)

**Files:**
- Modify: `app/benchmark/page.tsx`

- [ ] **Step 1: Add transit data fetch and state**

In the component that renders the Summary tab, add these state variables alongside the existing `walkScoreData` state:

```typescript
const [transitData, setTransitData] = useState<{
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
} | null>(null);
```

Add a fetch effect that triggers when the Summary tab is active and address is available:

```typescript
useEffect(() => {
  if (activeTab !== "summary" || !formData.address || !formData.city) return;

  const controller = new AbortController();
  fetch("/api/transit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: formData.address,
      city: formData.city,
      stateProvince: formData.stateProvince,
      zipCode: formData.zipCode,
      country: formData.country,
    }),
    signal: controller.signal,
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) {
        setTransitData({
          totalWeekdayTrips: data.totalWeekdayTrips,
          totalWeekendTrips: data.totalWeekendTrips,
          transitScore: data.transitScore,
        });
      }
    })
    .catch(() => {});

  return () => controller.abort();
}, [activeTab, formData.address, formData.city, formData.stateProvince, formData.zipCode, formData.country]);
```

- [ ] **Step 2: Update `ltc3TotalPoints` calculation**

Find line 579:
```typescript
const ltc3TotalPoints = walkScorePoints; // simplified: only walk score for now
```

Replace with:
```typescript
const transitScore = transitData?.transitScore ?? 0;
const ltc3TotalPoints = walkScorePoints + transitScore;
```

- [ ] **Step 3: Update the LTc3 Option 2 display**

Find lines 627-649 (the Option 2 section). Replace the placeholder text:

```typescript
<div>
  <OptionRow
    label="Option 2. Access to Transit"
    points={transitData?.transitScore ?? 0}
    badge="docs-available"
  >
    <Link
      href={`/benchmark/transit?${new URLSearchParams({
        address: formData.address,
        city: formData.city,
        stateProvince: formData.stateProvince,
        zipCode: formData.zipCode,
        country: formData.country,
      }).toString()}`}
      target="_blank"
      className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
    >
      View Transit Map &rarr;
    </Link>
  </OptionRow>
  <div className="pl-10 pb-3">
    <p className="text-sm text-muted-foreground">
      {transitData ? `${transitData.totalWeekdayTrips} Weekday Trips` : "Loading..."}
    </p>
    <p className="text-sm text-muted-foreground">
      {transitData ? `${transitData.totalWeekendTrips} Weekend Trips` : "Loading..."}
    </p>
  </div>
</div>
```

- [ ] **Step 4: Verify TypeScript compiles fully**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/benchmark/page.tsx
git commit -m "feat: integrate transit score into benchmark LTc3 Option 2 display"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Test the API manually**

Run:
```bash
curl -s -X POST http://localhost:3000/api/transit \
  -H "Content-Type: application/json" \
  -d '{"address":"7th Ave & Central Park S","city":"New York","stateProvince":"NY","zipCode":"10019","country":"US"}' | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('stations:',j.stations.length,'weekday:',j.totalWeekdayTrips,'weekend:',j.totalWeekendTrips,'score:',j.transitScore)})"
```
Expected: Non-zero stations, weekday trips, weekend trips, and a score between 0-4

- [ ] **Step 4: Visual check — Transit page**

Open `http://localhost:3000/benchmark/transit?address=7th+Ave+%26+Central+Park+S&city=New+York&stateProvince=NY&zipCode=10019&country=US`

Verify:
- Map shows station markers (orange for bus, purple for subway)
- ResultsPanel shows trip counts and points
- StationListPanel (when expanded) shows per-route weekday/weekend trips
- Routes marked as "counted at other stop" appear greyed out

- [ ] **Step 5: Visual check — Benchmark page**

Open `http://localhost:3000/benchmark`, fill in the NYC address, go to Summary tab.

Verify:
- LTc3 Option 2 shows real weekday/weekend trip counts (not "X"/"Y")
- Points display reflects the actual LEED score
- Total LT points include transit score

- [ ] **Step 6: Edge case — Address with no nearby GTFS stops**

Test with an address far from NYC (e.g., "123 Main St", "Los Angeles", "CA"):
Expected: 0 stations, 0 trips, 0 points
