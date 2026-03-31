# Subway-First Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement LEED LTc3 Option 2 subway-first scoring with station-by-station accumulation, early termination, and walking route rendering.

**Architecture:** Preprocess merges N/S GTFS platforms into stations. API route uses GTFS + Distance Matrix (no Google Places). Scoring accumulates trips nearest-first with early stop at 4 points. Frontend renders only qualifying stations with walking route polylines.

**Tech Stack:** Next.js 15, TypeScript, @vis.gl/react-google-maps, Google Distance Matrix API, Google Directions API (JS SDK), Vitest

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/preprocess-gtfs.ts` | Parse GTFS files, merge N/S platforms, output station-level `stop-trips.json` |
| `lib/transit-types.ts` | Shared TypeScript interfaces and constants |
| `lib/transit-scoring.ts` | Pure scoring logic: station-by-station accumulation with early termination |
| `lib/google-maps.ts` | Haversine distance function, radius constants |
| `app/api/transit/route.ts` | API endpoint: geocode, GTFS lookup, Distance Matrix, scoring |
| `app/benchmark/transit/page.tsx` | Map UI: qualifying station markers, walking route polylines, results panel |
| `tests/preprocess-gtfs.test.ts` | Tests for N/S merge logic |
| `tests/transit-scoring.test.ts` | Tests for new scoring logic |

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `lib/transit-types.ts`

- [ ] **Step 1: Update `StopData` — remove `parentStation`**

Open `lib/transit-types.ts` and replace the `StopData` interface:

```typescript
export interface StopData {
  stopName: string;
  lat: number;
  lng: number;
  routes: Record<string, StopRouteData>;
}
```

Remove the `parentStation: string;` line. The merged station-level index no longer needs this field.

- [ ] **Step 2: Update `TransitStation` — remove `placeId`, make `stopId` required**

Replace the `TransitStation` interface:

```typescript
export interface TransitStation {
  stopId: string;
  name: string;
  location: { lat: number; lng: number };
  walkingDistanceMi: number;
  stationType: StationType;
  routes: RouteTrips[];
}
```

`placeId` is removed (no more Google Places). `stopId` is now required (was optional).

- [ ] **Step 3: Update `TransitApiResponse`**

Replace the `TransitApiResponse` interface:

```typescript
export interface TransitApiResponse {
  qualifyingStations: TransitStation[];
  allNearbyStations: TransitStation[];
  geocodedLocation: { lat: number; lng: number };
  address: string;
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}
```

`stations` is replaced by `qualifyingStations` (scored) and `allNearbyStations` (all within 0.5mi walking).

- [ ] **Step 4: Add `ScoredStation` type for scoring input**

Add this new interface after `TransitScoreResult`:

```typescript
export interface ScoredStation {
  stopId: string;
  stop: StopData;
  walkingDistanceMi: number;
}
```

- [ ] **Step 5: Update `TransitScoreResult` to include qualifying stations**

Replace the `TransitScoreResult` interface:

```typescript
export interface TransitScoreResult {
  qualifyingRoutes: QualifyingRoute[];
  qualifyingStopIds: string[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  points: number;
  threshold: { weekday: number; weekend: number } | null;
}
```

Added `qualifyingStopIds: string[]` — the list of station IDs that contributed at least one route to the score.

- [ ] **Step 6: Remove `QUARTER_MILE_METERS` from `lib/google-maps.ts`**

Open `lib/google-maps.ts` and remove the line:

```typescript
export const QUARTER_MILE_METERS = 402.336; // 0.25 mi
```

Keep `HALF_MILE_METERS` — it's still used for the 0.5mi reference circle.

- [ ] **Step 7: Verify TypeScript compiles (expect errors in consumers)**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: Errors in `app/api/transit/route.ts`, `app/benchmark/transit/page.tsx`, `lib/transit-scoring.ts`, and `tests/`. This confirms the type changes propagated correctly. These files will be fixed in subsequent tasks.

- [ ] **Step 8: Commit**

```bash
git add lib/transit-types.ts lib/google-maps.ts
git commit -m "refactor: update transit types for subway-first scoring

- Remove parentStation from StopData (N/S merge makes it unnecessary)
- Remove placeId from TransitStation (no more Google Places)
- Split TransitApiResponse into qualifyingStations + allNearbyStations
- Add ScoredStation type for scoring input
- Add qualifyingStopIds to TransitScoreResult
- Remove QUARTER_MILE_METERS (bus circle removed)"
```

---

### Task 2: Preprocess N/S Platform Merge

**Files:**
- Modify: `scripts/preprocess-gtfs.ts`
- Modify: `tests/preprocess-gtfs.test.ts`

- [ ] **Step 1: Write failing test for `mergeNSPlatforms`**

Add to `tests/preprocess-gtfs.test.ts`:

```typescript
import {
  parseCalendar,
  parseRoutes,
  parseTrips,
  aggregateStopTrips,
  mergeNSPlatforms,
} from "@/scripts/preprocess-gtfs";
import type { StopTripsIndex } from "@/lib/transit-types";

// ... existing tests stay ...

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
    const station = merged["120"];
    expect(station.stopName).toBe("96 St");
    expect(station.lat).toBe(40.7936); // uses N platform coords
    expect(station.routes["1"].directions).toEqual([0, 1]);
    expect(station.routes["1"].dir0WeekdayMin).toBe(231);
    expect(station.routes["1"].dir1WeekdayMin).toBe(231);
    expect(station.routes["1"].dir0WeekendMax).toBe(186);
    expect(station.routes["1"].dir1WeekendMax).toBe(186);
  });

  it("handles unpaired N-only station (keeps as single direction)", () => {
    const raw: StopTripsIndex = {
      "711N": {
        stopName: "69 St",
        lat: 40.123,
        lng: -73.456,
        routes: {
          "R": {
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
    expect(merged["711"].routes["R"].directions).toEqual([0]);
  });

  it("merges multi-route station correctly", () => {
    const raw: StopTripsIndex = {
      "100N": {
        stopName: "Times Sq",
        lat: 40.756,
        lng: -73.987,
        routes: {
          "1": {
            routeName: "1", routeType: 1, directions: [0],
            dir0WeekdayMin: 200, dir0WeekendMax: 150,
            dir1WeekdayMin: 0, dir1WeekendMax: 0,
          },
          "N": {
            routeName: "N", routeType: 1, directions: [0],
            dir0WeekdayMin: 180, dir0WeekendMax: 120,
            dir1WeekdayMin: 0, dir1WeekendMax: 0,
          },
        },
      },
      "100S": {
        stopName: "Times Sq",
        lat: 40.756,
        lng: -73.987,
        routes: {
          "1": {
            routeName: "1", routeType: 1, directions: [1],
            dir0WeekdayMin: 0, dir0WeekendMax: 0,
            dir1WeekdayMin: 195, dir1WeekendMax: 145,
          },
          "Q": {
            routeName: "Q", routeType: 1, directions: [1],
            dir0WeekdayMin: 0, dir0WeekendMax: 0,
            dir1WeekdayMin: 160, dir1WeekendMax: 100,
          },
        },
      },
    };

    const merged = mergeNSPlatforms(raw);
    expect(Object.keys(merged)).toEqual(["100"]);
    const s = merged["100"];
    // Route "1" merged from both platforms
    expect(s.routes["1"].directions).toEqual([0, 1]);
    expect(s.routes["1"].dir0WeekdayMin).toBe(200);
    expect(s.routes["1"].dir1WeekdayMin).toBe(195);
    // Route "N" only on N platform
    expect(s.routes["N"].directions).toEqual([0]);
    // Route "Q" only on S platform
    expect(s.routes["Q"].directions).toEqual([1]);
  });

  it("passes through stops without N/S suffix unchanged", () => {
    const raw: StopTripsIndex = {
      "MISC": {
        stopName: "Special Stop",
        lat: 40.0,
        lng: -73.0,
        routes: {},
      },
    };

    const merged = mergeNSPlatforms(raw);
    expect(merged["MISC"]).toBeDefined();
    expect(merged["MISC"].stopName).toBe("Special Stop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/preprocess-gtfs.test.ts`

Expected: FAIL — `mergeNSPlatforms` is not exported from `@/scripts/preprocess-gtfs`.

- [ ] **Step 3: Implement `mergeNSPlatforms` in `scripts/preprocess-gtfs.ts`**

Add this exported function after the `aggregateStopTrips` function:

```typescript
export function mergeNSPlatforms(raw: StopTripsIndex): StopTripsIndex {
  // Group by base stop_id (strip trailing N/S)
  const groups = new Map<string, { n?: StopData; s?: StopData; other?: StopData }>();

  for (const [stopId, stop] of Object.entries(raw)) {
    if (stopId.endsWith("N")) {
      const base = stopId.slice(0, -1);
      const g = groups.get(base) ?? {};
      g.n = stop;
      groups.set(base, g);
    } else if (stopId.endsWith("S")) {
      const base = stopId.slice(0, -1);
      const g = groups.get(base) ?? {};
      g.s = stop;
      groups.set(base, g);
    } else {
      groups.set(stopId, { other: stop });
    }
  }

  const merged: StopTripsIndex = {};

  for (const [baseId, group] of groups.entries()) {
    // Non-N/S stop: pass through
    if (group.other) {
      merged[baseId] = group.other;
      continue;
    }

    const primary = group.n ?? group.s!;
    const secondary = group.n ? group.s : undefined;

    const mergedRoutes: Record<string, StopRouteData> = {};

    // Collect all route IDs from both platforms
    const allRouteIds = new Set([
      ...Object.keys(primary.routes),
      ...(secondary ? Object.keys(secondary.routes) : []),
    ]);

    for (const routeId of allRouteIds) {
      const nRoute = group.n?.routes[routeId];
      const sRoute = group.s?.routes[routeId];

      if (nRoute && sRoute) {
        // Merge: N contributes dir0, S contributes dir1
        const dirs = Array.from(new Set([...nRoute.directions, ...sRoute.directions])).sort();
        mergedRoutes[routeId] = {
          routeName: nRoute.routeName,
          routeType: nRoute.routeType,
          directions: dirs,
          dir0WeekdayMin: nRoute.dir0WeekdayMin,
          dir0WeekendMax: nRoute.dir0WeekendMax,
          dir1WeekdayMin: sRoute.dir1WeekdayMin,
          dir1WeekendMax: sRoute.dir1WeekendMax,
        };
      } else {
        // Only on one platform — keep as-is
        mergedRoutes[routeId] = (nRoute ?? sRoute)!;
      }
    }

    merged[baseId] = {
      stopName: primary.stopName,
      lat: primary.lat,
      lng: primary.lng,
      routes: mergedRoutes,
    };
  }

  return merged;
}
```

Also add the import for `StopData` at the top if not already present:

```typescript
import type { StopTripsIndex, StopRouteData, StopData } from "@/lib/transit-types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/preprocess-gtfs.test.ts`

Expected: All tests PASS (including the 4 new merge tests and the 5 existing tests).

- [ ] **Step 5: Update the `main()` function to use `mergeNSPlatforms`**

In the `main()` function of `scripts/preprocess-gtfs.ts`, after building the `index` object (around line 264), add the merge step:

Replace the block that writes to file:

```typescript
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index));
```

With:

```typescript
  console.log("  Merging N/S platforms...");
  const mergedIndex = mergeNSPlatforms(index);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mergedIndex));

  const stopCount = Object.keys(mergedIndex).length;
  const routeCount = new Set(
    Object.values(mergedIndex).flatMap((s) => Object.keys(s.routes))
  ).size;
  const fileSizeMb = (Buffer.byteLength(JSON.stringify(mergedIndex)) / 1024 / 1024).toFixed(1);
```

Also update the `index` variable in the loop above to remove the `parentStation` field assignment. Replace:

```typescript
    index[stopId] = {
      stopName: stopInfo.stopName,
      lat: stopInfo.lat,
      lng: stopInfo.lng,
      parentStation: stopInfo.parentStation,
      routes: data.routes,
    };
```

With:

```typescript
    index[stopId] = {
      stopName: stopInfo.stopName,
      lat: stopInfo.lat,
      lng: stopInfo.lng,
      routes: data.routes,
    };
```

- [ ] **Step 6: Run the preprocessor to regenerate the index**

Run: `pnpm run preprocess-gtfs`

Expected output should show ~496 stops (down from 989) and the merged index file.

- [ ] **Step 7: Verify the generated index has merged stations**

Run:

```bash
node -e "const d=require('./public/gtfs_supplemented/index/stop-trips.json'); const k=Object.keys(d); console.log('Stations:', k.length); const s=d['120']; if(s){console.log('96 St routes:', Object.keys(s.routes)); console.log('Route 1 dirs:', s.routes['1']?.directions)} else {console.log('120 not found')}"
```

Expected: Stations: ~496, 96 St has route 1 with directions [0, 1].

- [ ] **Step 8: Commit**

```bash
git add scripts/preprocess-gtfs.ts tests/preprocess-gtfs.test.ts public/gtfs_supplemented/index/stop-trips.json
git commit -m "feat: merge N/S GTFS platforms into station-level index

- Add mergeNSPlatforms() to combine northbound/southbound platforms
- Index shrinks from 989 platform-level entries to ~496 station-level
- Each station now has complete bi-directional route data
- Fixes bug where all stations had zero qualifying routes
- Remove parentStation from index output"
```

---

### Task 3: Rewrite Scoring Logic

**Files:**
- Modify: `lib/transit-scoring.ts`
- Modify: `tests/transit-scoring.test.ts`

- [ ] **Step 1: Write failing tests for new `scoreTransit`**

Replace the entire content of `tests/transit-scoring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  calculateTransitScore,
  computeRouteTrips,
  scoreTransit,
  findNearbyGtfsStops,
} from "@/lib/transit-scoring";
import type { StopData, ScoredStation } from "@/lib/transit-types";

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
  for (const rc of routeConfigs) {
    routes[rc.routeId] = {
      routeName: rc.routeName,
      routeType: 1,
      directions: [0, 1],
      dir0WeekdayMin: rc.dir0WeekdayMin,
      dir0WeekendMax: rc.dir0WeekendMax,
      dir1WeekdayMin: rc.dir1WeekdayMin,
      dir1WeekendMax: rc.dir1WeekendMax,
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
          { routeId: "1", routeName: "1", dir0WeekdayMin: 231, dir0WeekendMax: 186, dir1WeekdayMin: 231, dir1WeekendMax: 186 },
          { routeId: "2", routeName: "2", dir0WeekdayMin: 162, dir0WeekendMax: 139, dir1WeekdayMin: 162, dir1WeekendMax: 139 },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    expect(result.totalWeekdayTrips).toBe(231 + 162);
    expect(result.totalWeekendTrips).toBe(186 + 139);
    expect(result.points).toBe(4); // 393 >= 360, 325 >= 216
    expect(result.qualifyingStopIds).toEqual(["120"]);
  });

  it("accumulates across multiple stations, deduplicates routes", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "A",
        walkingDistanceMi: 0.1,
        stop: makeStation([
          { routeId: "1", routeName: "1", dir0WeekdayMin: 50, dir0WeekendMax: 30, dir1WeekdayMin: 50, dir1WeekendMax: 30 },
        ]),
      },
      {
        stopId: "B",
        walkingDistanceMi: 0.2,
        stop: makeStation([
          { routeId: "1", routeName: "1", dir0WeekdayMin: 60, dir0WeekendMax: 40, dir1WeekdayMin: 60, dir1WeekendMax: 40 },
          { routeId: "2", routeName: "2", dir0WeekdayMin: 80, dir0WeekendMax: 50, dir1WeekdayMin: 80, dir1WeekendMax: 50 },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    // Route "1" counted from station A (nearest), route "2" from station B
    expect(result.totalWeekdayTrips).toBe(50 + 80);
    expect(result.totalWeekendTrips).toBe(30 + 50);
    expect(result.qualifyingStopIds).toEqual(["A", "B"]);
    expect(result.qualifyingRoutes).toHaveLength(2);
    expect(result.qualifyingRoutes.find(r => r.routeId === "1")?.stopId).toBe("A");
    expect(result.qualifyingRoutes.find(r => r.routeId === "2")?.stopId).toBe("B");
  });

  it("stops early when 4 points reached", () => {
    const stops: ScoredStation[] = [
      {
        stopId: "X",
        walkingDistanceMi: 0.1,
        stop: makeStation([
          { routeId: "A", routeName: "A", dir0WeekdayMin: 200, dir0WeekendMax: 120, dir1WeekdayMin: 200, dir1WeekendMax: 120 },
          { routeId: "B", routeName: "B", dir0WeekdayMin: 200, dir0WeekendMax: 120, dir1WeekdayMin: 200, dir1WeekendMax: 120 },
        ]),
      },
      {
        stopId: "Y",
        walkingDistanceMi: 0.3,
        stop: makeStation([
          { routeId: "C", routeName: "C", dir0WeekdayMin: 100, dir0WeekendMax: 80, dir1WeekdayMin: 100, dir1WeekendMax: 80 },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    // Station X alone: weekday=400, weekend=240 → 4 points → stop
    expect(result.points).toBe(4);
    expect(result.qualifyingStopIds).toEqual(["X"]);
    // Station Y should not be included
    expect(result.qualifyingRoutes.find(r => r.routeId === "C")).toBeUndefined();
  });

  it("skips single-direction routes (no paired service)", () => {
    const stop = makeStation([
      { routeId: "1", routeName: "1", dir0WeekdayMin: 200, dir0WeekendMax: 150, dir1WeekdayMin: 200, dir1WeekendMax: 150 },
    ]);
    // Override route "1" to only have direction 0
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
          { routeId: "1", routeName: "1", dir0WeekdayMin: 50, dir0WeekendMax: 20, dir1WeekdayMin: 50, dir1WeekendMax: 20 },
        ]),
      },
      {
        stopId: "B",
        walkingDistanceMi: 0.2,
        stop: makeStation([
          { routeId: "1", routeName: "1", dir0WeekdayMin: 60, dir0WeekendMax: 25, dir1WeekdayMin: 60, dir1WeekendMax: 25 },
        ]),
      },
    ];

    const result = scoreTransit(stops);
    // Route "1" counted from A only. B contributes nothing new.
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
            routeName: "1", routeType: 1, directions: [0, 1],
            dir0WeekdayMin: 142, dir0WeekendMax: 98,
            dir1WeekdayMin: 138, dir1WeekendMax: 95,
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
        lat: 40.780,
        lng: -73.982,
        routes: {
          "1": {
            routeName: "1", routeType: 1, directions: [0, 1],
            dir0WeekdayMin: 142, dir0WeekendMax: 98,
            dir1WeekdayMin: 138, dir1WeekendMax: 95,
          },
        },
      },
    };
    const center = { lat: 40.768, lng: -73.982 };
    const result = findNearbyGtfsStops(index, center);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/transit-scoring.test.ts`

Expected: FAIL — `scoreTransit` has wrong signature, `ScoredStation` not exported.

- [ ] **Step 3: Rewrite `lib/transit-scoring.ts`**

Replace the entire content of `lib/transit-scoring.ts`:

```typescript
import { haversineDistanceMi } from "@/lib/google-maps";
import {
  TRANSIT_THRESHOLDS,
  maxDistanceForRouteType,
  stationTypeFromRouteType,
  type StopTripsIndex,
  type StopRouteData,
  type StopData,
  type QualifyingRoute,
  type TransitScoreResult,
  type TransitStation,
  type RouteTrips,
  type ScoredStation,
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
  if (!route.directions.includes(0) || !route.directions.includes(1)) {
    return null;
  }
  const weekdayTrips = Math.min(route.dir0WeekdayMin, route.dir1WeekdayMin);
  const weekendTrips = Math.min(route.dir0WeekendMax, route.dir1WeekendMax);
  return { weekdayTrips, weekendTrips };
}

// --- Nearby stop finding (haversine pre-filter) ---

interface NearbyStop {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  distanceMi: number;
  routes: Record<string, StopRouteData>;
}

export function findNearbyGtfsStops(
  index: StopTripsIndex,
  center: { lat: number; lng: number },
  maxMi: number = 0.5
): NearbyStop[] {
  const results: NearbyStop[] = [];

  for (const [stopId, stop] of Object.entries(index)) {
    const stopLoc = { lat: stop.lat, lng: stop.lng };
    const distMi = haversineDistanceMi(center, stopLoc);

    if (distMi > maxMi) continue;

    results.push({
      stopId,
      stopName: stop.stopName,
      lat: stop.lat,
      lng: stop.lng,
      distanceMi: Math.round(distMi * 100) / 100,
      routes: stop.routes,
    });
  }

  return results.sort((a, b) => a.distanceMi - b.distanceMi);
}

// --- Station-by-station scoring with early termination ---

const MAX_POINTS = 4;

export function scoreTransit(
  stops: ScoredStation[]
): TransitScoreResult {
  const countedRoutes = new Set<string>();
  const qualifyingRoutes: QualifyingRoute[] = [];
  const qualifyingStopIds: string[] = [];
  let totalWeekdayTrips = 0;
  let totalWeekendTrips = 0;

  for (const { stopId, stop, walkingDistanceMi } of stops) {
    let stationContributed = false;

    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      // Skip already-counted routes
      if (countedRoutes.has(routeId)) continue;

      // Check distance limit by route type
      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (walkingDistanceMi > routeMaxDist) continue;

      // Paired service check
      const trips = computeRouteTrips(routeData);
      if (!trips) continue;

      countedRoutes.add(routeId);
      totalWeekdayTrips += trips.weekdayTrips;
      totalWeekendTrips += trips.weekendTrips;
      stationContributed = true;

      qualifyingRoutes.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        stopId,
        stopName: stop.stopName,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
      });
    }

    if (stationContributed) {
      qualifyingStopIds.push(stopId);
    }

    // Early termination: check if max score reached
    const { points } = calculateTransitScore(totalWeekdayTrips, totalWeekendTrips);
    if (points >= MAX_POINTS) break;
  }

  const { points, threshold } = calculateTransitScore(totalWeekdayTrips, totalWeekendTrips);

  return {
    qualifyingRoutes,
    qualifyingStopIds,
    totalWeekdayTrips,
    totalWeekendTrips,
    points,
    threshold,
  };
}

// --- Build TransitStation[] for API response ---

export function buildStationList(
  stops: ScoredStation[],
  scoreResult: TransitScoreResult
): { qualifyingStations: TransitStation[]; allNearbyStations: TransitStation[] } {
  const countedSet = new Set(
    scoreResult.qualifyingRoutes.map((r) => `${r.routeId}::${r.stopId}`)
  );
  const qualifyingSet = new Set(scoreResult.qualifyingStopIds);

  const allNearbyStations: TransitStation[] = stops.map(({ stopId, stop, walkingDistanceMi }) => {
    const routeTrips: RouteTrips[] = [];
    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      const trips = computeRouteTrips(routeData);
      if (!trips) continue;

      routeTrips.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
        counted: countedSet.has(`${routeId}::${stopId}`),
      });
    }

    // Determine station type from dominant route type
    const routeEntries = Object.values(stop.routes);
    const dominantRouteType = routeEntries.length > 0
      ? routeEntries.reduce((best, r) =>
          maxDistanceForRouteType(r.routeType) > maxDistanceForRouteType(best.routeType) ? r : best
        ).routeType
      : 1;

    return {
      stopId,
      name: stop.stopName,
      location: { lat: stop.lat, lng: stop.lng },
      walkingDistanceMi,
      stationType: stationTypeFromRouteType(dominantRouteType),
      routes: routeTrips,
    };
  }).filter((s) => s.routes.length > 0);

  const qualifyingStations = allNearbyStations.filter((s) => qualifyingSet.has(s.stopId));

  return { qualifyingStations, allNearbyStations };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/transit-scoring.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/transit-scoring.ts tests/transit-scoring.test.ts
git commit -m "feat: station-by-station scoring with early termination

- scoreTransit takes pre-sorted stations with walking distances
- Accumulates trips nearest-first, deduplicates routes by routeId
- Stops early when 4 points (360/216) reached
- buildStationList splits output into qualifying + all nearby
- 12 unit tests covering accumulation, dedup, early stop, edge cases"
```

---

### Task 4: Rewrite API Route

**Files:**
- Modify: `app/api/transit/route.ts`

- [ ] **Step 1: Replace `app/api/transit/route.ts` entirely**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { haversineDistanceMi } from "@/lib/google-maps";
import type { StopTripsIndex, TransitApiResponse, ScoredStation } from "@/lib/transit-types";
import { scoreTransit, buildStationList, findNearbyGtfsStops } from "@/lib/transit-scoring";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// --- GTFS index (cached at module level) ---

let gtfsIndex: StopTripsIndex | null = null;
function getGtfsIndex(): StopTripsIndex {
  if (!gtfsIndex) {
    const indexPath = join(
      process.cwd(),
      "public/gtfs_supplemented/index/stop-trips.json"
    );
    try {
      gtfsIndex = JSON.parse(
        readFileSync(indexPath, "utf-8")
      ) as StopTripsIndex;
    } catch {
      throw new Error(
        "GTFS index not found. Run `pnpm run preprocess-gtfs` first."
      );
    }
  }
  return gtfsIndex;
}

type TransitPayload = {
  address?: string;
  city?: string;
  stateProvince?: string;
  zipCode?: string;
  country?: string;
};

// --- Geocoding ---

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

// --- Walking distance via Distance Matrix API ---

interface WalkingDistanceResult {
  distanceMi: number | null;
}

async function getWalkingDistances(
  origin: { lat: number; lng: number },
  destinations: { lat: number; lng: number }[],
  signal: AbortSignal
): Promise<WalkingDistanceResult[]> {
  if (destinations.length === 0) return [];

  const origStr = `${origin.lat},${origin.lng}`;
  const destStr = destinations
    .map((d) => `${d.lat},${d.lng}`)
    .join("|");

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origStr}&destinations=${destStr}&mode=walking&units=imperial&key=${API_KEY}`;

  try {
    const res = await fetchWithRetry(url, { signal });
    const data = await res.json();

    if (data.status !== "OK" || !data.rows?.[0]?.elements) {
      return destinations.map(() => ({ distanceMi: null }));
    }

    return data.rows[0].elements.map(
      (el: { status: string; distance?: { value: number } }) => {
        if (el.status !== "OK" || !el.distance) return { distanceMi: null };
        return { distanceMi: el.distance.value / 1609.344 };
      }
    );
  } catch {
    return destinations.map(() => ({ distanceMi: null }));
  }
}

// --- Main handler ---

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key is not configured." },
      { status: 500 }
    );
  }

  let index: StopTripsIndex;
  try {
    index = getGtfsIndex();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }

  try {
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

    // 2. Haversine pre-filter: generous 0.75mi to account for walking vs straight-line
    const nearbyCandidates = findNearbyGtfsStops(index, location, 0.75);

    if (nearbyCandidates.length === 0) {
      const response: TransitApiResponse = {
        qualifyingStations: [],
        allNearbyStations: [],
        geocodedLocation: location,
        address: fullAddress,
        totalWeekdayTrips: 0,
        totalWeekendTrips: 0,
        transitScore: 0,
      };
      return NextResponse.json(response);
    }

    // 3. Batch walking distances via Distance Matrix API
    const walkingResults = await getWalkingDistances(
      location,
      nearbyCandidates.map((s) => ({ lat: s.lat, lng: s.lng })),
      signal
    );

    // 4. Build scored stations with walking distances, filter ≤ 0.5mi, sort ascending
    const scoredStops: ScoredStation[] = nearbyCandidates
      .map((candidate, i) => {
        const walkDist = walkingResults[i].distanceMi
          ?? candidate.distanceMi; // fallback to haversine
        return {
          stopId: candidate.stopId,
          stop: index[candidate.stopId],
          walkingDistanceMi: Math.round(walkDist * 100) / 100,
        };
      })
      .filter((s) => s.walkingDistanceMi <= 0.5)
      .sort((a, b) => a.walkingDistanceMi - b.walkingDistanceMi);

    // 5. Score: station-by-station accumulation with early termination
    const scoreResult = scoreTransit(scoredStops);

    // 6. Build response
    const { qualifyingStations, allNearbyStations } = buildStationList(
      scoredStops,
      scoreResult
    );

    const response: TransitApiResponse = {
      qualifyingStations,
      allNearbyStations,
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

Run: `npx tsc --noEmit 2>&1 | grep -v "benchmark/transit/page.tsx" | head -20`

Expected: No errors except from the frontend page (which is fixed in Task 5). If there are other errors, fix them.

- [ ] **Step 3: Commit**

```bash
git add app/api/transit/route.ts
git commit -m "feat: simplify transit API to GTFS-only with Distance Matrix

- Remove Google Places Nearby Search dependency
- Remove GTFS-to-Places matching logic
- Use GTFS index directly for station discovery
- Haversine pre-filter at 0.75mi, then Distance Matrix for walking distances
- Filter to 0.5mi walking, pass to scoreTransit for station-by-station scoring
- Return qualifyingStations + allNearbyStations"
```

---

### Task 5: Update Frontend — Map, Walking Routes, Results Panel

**Files:**
- Modify: `app/benchmark/transit/page.tsx`

- [ ] **Step 1: Replace `app/benchmark/transit/page.tsx` entirely**

```typescript
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Circle,
  useMap,
  useMapsLibrary,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { TrainFront, MapPin, Loader2, ChevronDown } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { HALF_MILE_METERS } from "@/lib/google-maps";
import {
  type TransitStation,
  type TransitApiResponse,
  type RouteTrips,
} from "@/lib/transit-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const DEFAULT_ZOOM = 15;
const WALKING_ROUTE_COLORS = ["#4285f4", "#34a853", "#ea4335", "#fbbc04", "#9c27b0"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Legend overlay (top-right of the map) */
function MapLegend() {
  return (
    <div className="absolute right-3 top-3 z-10 rounded-2xl bg-white px-4 py-3 shadow-md">
      <div className="flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 border-t-2 border-dashed border-[#7cb342]" />
        0.5 mi reference
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-purple-600" />
        Qualifying Subway Station
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="inline-block h-0.5 w-8 bg-[#4285f4]" />
        Walking Route
      </div>
    </div>
  );
}

/** Walking route polyline for a single station */
function WalkingRoute({
  origin,
  destination,
  color,
}: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  color: string;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  useEffect(() => {
    if (!map || !routesLib) return;

    const service = new routesLib.DirectionsService();
    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.8,
      },
    });
    rendererRef.current = renderer;

    service.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.WALKING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result);
        }
      }
    );

    return () => {
      renderer.setMap(null);
      rendererRef.current = null;
    };
  }, [map, routesLib, origin, destination, color]);

  return null;
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

  return (
    <>
      <AdvancedMarker
        position={station.location}
        onClick={() => setOpen((v) => !v)}
        title={station.name}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 shadow-md">
          <TrainFront className="h-4 w-4 text-white" />
        </div>
      </AdvancedMarker>

      {open && (
        <InfoWindow
          position={station.location}
          onCloseClick={() => setOpen(false)}
        >
          <div className="max-w-[240px] space-y-1 p-1">
            <p className="text-sm font-bold">{station.name}</p>
            <p className="text-xs text-muted-foreground">
              {station.walkingDistanceMi.toFixed(2)} mi walking
            </p>
            {station.routes.length > 0 && (
              <div className="space-y-1 pt-1">
                {station.routes.map((r) => (
                  <div
                    key={r.routeId}
                    className={`flex items-center justify-between gap-2 text-[10px] ${r.counted ? "" : "opacity-50"}`}
                  >
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-bold text-white ${r.counted ? "bg-blue-600" : "bg-gray-400 line-through"}`}
                    >
                      {r.routeName}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
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
        {station.routes.slice(0, 4).map((r) => (
          <span
            key={r.routeId}
            className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold leading-none shadow ${r.counted ? "bg-blue-600 text-white" : "bg-gray-300 text-gray-500 line-through"}`}
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
// Transit Map
// ---------------------------------------------------------------------------

function TransitMap({
  center,
  qualifyingStations,
}: {
  center: { lat: number; lng: number };
  qualifyingStations: TransitStation[];
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
          <MapBoundsFitter center={center} stations={qualifyingStations} />

          {/* 0.5 mi reference circle */}
          <Circle
            center={center}
            radius={HALF_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.5}
            fillColor="#7cb342"
            fillOpacity={0.03}
          />

          {/* Project marker */}
          <AdvancedMarker position={center} title="Project Location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 shadow-lg ring-2 ring-white">
              <MapPin className="h-5 w-5 text-white" />
            </div>
          </AdvancedMarker>

          {/* Walking routes to qualifying stations */}
          {qualifyingStations.map((station, i) => (
            <WalkingRoute
              key={`walk-${station.stopId}`}
              origin={center}
              destination={station.location}
              color={WALKING_ROUTE_COLORS[i % WALKING_ROUTE_COLORS.length]}
            />
          ))}

          {/* Station markers + distance labels + route badges */}
          {qualifyingStations.map((station) => (
            <StationMarker key={station.stopId} station={station} />
          ))}
          {qualifyingStations.map((station) => (
            <DistanceLabel
              key={`dist-${station.stopId}`}
              from={center}
              to={station.location}
              distanceMi={station.walkingDistanceMi}
            />
          ))}
          {qualifyingStations.map((station) => (
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

function ResultsPanel({ data }: { data: TransitApiResponse }) {
  const { qualifyingStations, totalWeekdayTrips, totalWeekendTrips, transitScore } = data;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white px-6 py-6 text-center shadow-sm">
      <p className="text-lg text-foreground">
        <span className="font-bold">{qualifyingStations.length}</span>{" "}
        qualifying subway station{qualifyingStations.length !== 1 ? "s" : ""} (within 0.5 mi walking)
      </p>
      <p className="mt-3 text-5xl font-bold text-primary">
        {transitScore} / 4 Points
      </p>
      <div className="mt-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{totalWeekdayTrips}</span> weekday trips
        </span>
        <span>
          <span className="font-semibold text-foreground">{totalWeekendTrips}</span> weekend trips
        </span>
      </div>
      <p className="mt-2 text-lg text-muted-foreground">
        LEED v5 BD+C, LTc3 Access to Transit (Option 2)
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scoring breakdown panel
// ---------------------------------------------------------------------------

function ScoringBreakdown({ data }: { data: TransitApiResponse }) {
  const [open, setOpen] = useState(true);
  const { qualifyingStations } = data;

  if (qualifyingStations.length === 0) return null;

  let runningWeekday = 0;
  let runningWeekend = 0;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-primary/8 px-5 py-4 sm:px-6"
      >
        <h2 className="text-base font-bold uppercase tracking-[0.04em] text-primary sm:text-[1.15rem]">
          Scoring Breakdown ({qualifyingStations.length} station{qualifyingStations.length !== 1 ? "s" : ""})
        </h2>
        <ChevronDown
          className={`h-5 w-5 text-primary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="divide-y divide-[#E9ECEF]">
          {qualifyingStations.map((station, idx) => {
            const stationWeekday = station.routes
              .filter((r) => r.counted)
              .reduce((s, r) => s + r.weekdayTrips, 0);
            const stationWeekend = station.routes
              .filter((r) => r.counted)
              .reduce((s, r) => s + r.weekendTrips, 0);
            runningWeekday += stationWeekday;
            runningWeekend += stationWeekend;

            return (
              <div key={station.stopId} className="px-5 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <TrainFront className="h-4 w-4 text-purple-600" />
                    <span className="font-bold text-foreground">{station.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {station.walkingDistanceMi.toFixed(2)} mi
                  </span>
                </div>
                <div className="mt-2 space-y-1 pl-8">
                  {station.routes.filter((r) => r.counted).map((r) => (
                    <div key={r.routeId} className="flex items-center gap-2 text-xs">
                      <span className="inline-block rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {r.routeName}
                      </span>
                      <span className="text-muted-foreground">
                        +{r.weekdayTrips} wd / +{r.weekendTrips} we
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pl-8 text-xs text-muted-foreground">
                  Running total: <span className="font-semibold text-foreground">{runningWeekday}</span> weekday, <span className="font-semibold text-foreground">{runningWeekend}</span> weekend
                </div>
              </div>
            );
          })}
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
        <Button variant="outline" className="mt-4" onClick={() => fetchTransitData()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1140px] space-y-8 px-4 py-8 sm:px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          LEED v5 Access to Transit Calculator
        </h1>
        <p className="mt-2 text-base text-muted-foreground sm:text-lg">
          Type in your project address to view eligible LEED v5 credits and
          download the supporting documentation.
        </p>
      </div>

      <div className="rounded-lg bg-muted px-5 py-3">
        <p className="text-sm font-medium text-foreground">{fullAddress}</p>
      </div>

      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <TransitMap
          center={data.geocodedLocation}
          qualifyingStations={data.qualifyingStations}
        />
      </APIProvider>

      <ResultsPanel data={data} />

      <ScoringBreakdown data={data} />

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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compile (0 errors). If there are errors from `app/benchmark/page.tsx` due to the `TransitApiResponse` change (the `stations` → `qualifyingStations` rename), proceed to Step 3.

- [ ] **Step 3: Verify `app/benchmark/page.tsx` is unaffected**

`app/benchmark/page.tsx` only reads `totalWeekdayTrips`, `totalWeekendTrips`, and `transitScore` from the transit API — all three fields are unchanged in the new `TransitApiResponse`. No modification needed. Confirm by checking that it compiles cleanly in Step 5.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`

Expected: All tests PASS.

- [ ] **Step 5: Verify full TypeScript compile**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/benchmark/transit/page.tsx app/benchmark/page.tsx
git commit -m "feat: render only qualifying stations with walking routes

- Remove 0.25mi circle and bus markers (subway-only phase)
- Add WalkingRoute component using DirectionsService (walking mode)
- Only render qualifying stations on map with walking route polylines
- Add ScoringBreakdown panel showing per-station contribution
- ResultsPanel shows X/4 Points format
- Update benchmark/page.tsx for new TransitApiResponse shape"
```

---

### Task 6: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: All tests PASS (preprocess merge tests + scoring tests).

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Verify preprocessed index has merged data**

Run:

```bash
node -e "
const d=require('./public/gtfs_supplemented/index/stop-trips.json');
const keys=Object.keys(d);
console.log('Total stations:', keys.length);
const hasN = keys.some(k => k.endsWith('N'));
const hasS = keys.some(k => k.endsWith('S'));
console.log('Has N-suffix:', hasN);
console.log('Has S-suffix:', hasS);
// Check a known station
const ts = d['127'];  // Times Sq-42 St
if(ts) {
  console.log('Times Sq routes:', Object.keys(ts.routes).join(', '));
  const r1 = ts.routes['1'];
  if(r1) console.log('Route 1 dirs:', r1.directions, 'wd_min:', Math.min(r1.dir0WeekdayMin, r1.dir1WeekdayMin));
}
"
```

Expected: ~496 stations, no N/S suffixes, Times Sq has multiple routes with directions [0, 1].

- [ ] **Step 4: Start dev server and manually test**

Run: `pnpm dev`

Navigate to the transit page with a test address (e.g., `?address=7th+Ave+%26+Central+Park+S&city=New+York&stateProvince=NY&zipCode=10019&country=US`).

Verify:
- Map shows only qualifying subway stations (purple markers)
- Walking route polylines drawn from project to each qualifying station
- 0.5mi reference circle visible (no 0.25mi circle)
- Scoring breakdown panel shows per-station contributions with running totals
- Results show X/4 Points format
- Score is reasonable (Manhattan addresses should typically get 4/4)

- [ ] **Step 5: Final commit (if any fixes needed)**

Only if manual testing revealed issues that required code fixes.
