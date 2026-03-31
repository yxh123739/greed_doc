# Subway-First Scoring with Walking Routes — Design Spec

**Date:** 2026-03-31
**Phase:** A (Scoring Logic + UI). Phase B (DB migration + auto-download) deferred.
**Scope:** Subway only. Bus scoring out of scope for this spec.

---

## 1. Problem Statement

Current transit scoring has two critical issues:

1. **N/S platform split**: GTFS data stores stops at platform level (e.g., `120N`, `120S`). The scoring function `computeRouteTrips` requires both directions at the same stop, but each platform only has one direction. Result: **zero qualifying routes for all 989 stops**.

2. **All stations displayed**: The map shows every nearby station regardless of whether it contributes to the score. Per LEED LTc3 Option 2, only qualifying stations should be highlighted, with walking routes drawn.

3. **Google Places dependency**: Station discovery uses Google Places Nearby Search, which adds API cost, a fuzzy 0.1mi GTFS matching step, and has been the source of missing-station issues. GTFS already contains complete station coordinates.

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data source | GTFS only (`gtfs_supplemented`) | Both feeds have identical routes/stops; supplemented has 4x richer schedule data (78 calendar services vs 3) |
| N/S merge timing | Preprocess (not runtime) | Simpler runtime logic; index shrinks from 989 to ~496 entries; aligns with Phase B DB schema |
| Station discovery | GTFS coordinates + Distance Matrix | Eliminates Google Places API call and 0.1mi matching uncertainty |
| Scoring order | Nearest station first, early termination at 4 points | Per LTc3 spec: accumulate trips from nearest qualifying stations until max score reached |
| Walking route rendering | Frontend DirectionsService (JS SDK) | Max 2-3 routes per query; no backend needed; auto-renders polylines |
| Map circles | Keep 0.5mi circle only | Bus circle (0.25mi) irrelevant for subway-only phase |

---

## 3. Architecture

### 3.1 Preprocess: N/S Platform Merge

**File:** `scripts/preprocess-gtfs.ts`

**Merge algorithm:**
1. Parse all GTFS files as before (calendar, routes, trips, stops, stop_times)
2. Aggregate stop-level trip data as before
3. **New step**: Group stops by base stop_id (strip trailing `N`/`S`)
4. For each station group:
   - Coordinates: use the N-platform's lat/lng (or S if N absent)
   - Station name: use the N-platform's name (or S if N absent)
   - Routes: union all route_ids from both platforms
   - For each shared route: merge direction data — N contributes `dir0*` fields, S contributes `dir1*` fields
   - For routes only on one platform: keep as-is (will fail paired-service check, which is correct)
5. Output merged station-level index

**Edge cases:**
- 3 unpaired stops (69 St, 52 St, Aqueduct Racetrack): retained as single-direction; naturally excluded from scoring by the paired-service requirement
- Stops not ending in N/S: included as-is (none expected in current data, but defensive handling)

**Output:** `stop-trips.json` with ~496 station entries, each with complete bi-directional route data.

### 3.2 Type Changes

**File:** `lib/transit-types.ts`

```typescript
// StopData: remove parentStation field
export interface StopData {
  stopName: string;
  lat: number;
  lng: number;
  routes: Record<string, StopRouteData>;
}

// TransitStation: remove placeId, stopId becomes required
export interface TransitStation {
  stopId: string;
  name: string;
  location: { lat: number; lng: number };
  walkingDistanceMi: number;
  stationType: StationType;
  routes: RouteTrips[];
}

// TransitApiResponse: split into qualifying + all nearby
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

### 3.3 Scoring Logic: Station-by-Station Accumulation with Early Termination

**File:** `lib/transit-scoring.ts`

**New `scoreTransit` signature:**

```typescript
function scoreTransit(
  stops: { stopId: string; stop: StopData; walkingDistanceMi: number }[]
): TransitScoreResult
```

Takes a **pre-sorted** list of stations with walking distances (computed by the API route via Distance Matrix). The scoring function itself is pure — no API calls.

**Flow:**

1. Input: stations already filtered (≤ 0.5mi walking) and sorted by walking distance ascending
2. **Accumulation loop** (nearest first):
   - For each station, iterate its routes
   - Skip routes already counted (route-level dedup by routeId)
   - For qualifying routes (paired service): compute `weekdayTrips = min(dir0WeekdayMin, dir1WeekdayMin)`, `weekendTrips = min(dir0WeekendMax, dir1WeekendMax)`
   - Add to running totals
   - Check against threshold table: if weekday >= 360 AND weekend >= 216 → score = 4, **stop**
   - Mark station as "qualifying" if it contributed at least one new route
4. After loop (or early termination): return qualifying stations, totals, score

**Key difference from current code:** Current code finds all qualifying routes globally, then sums. New code processes station-by-station in distance order and can stop early.

### 3.4 API Route

**File:** `app/api/transit/route.ts`

**Simplified flow:**
1. Validate input, load GTFS index
2. Geocode address → `{lat, lng}`
3. Haversine pre-filter: find all GTFS stations within 0.75mi (generous buffer for walking distance)
4. Distance Matrix API: batch walking distances for all candidates
5. Filter to walking distance ≤ 0.5mi, sort ascending
6. Run station-by-station scoring with early termination
7. Return `TransitApiResponse` with `qualifyingStations` (scored) and `allNearbyStations` (all subway stations within 0.5mi walking, for debugging/display reference)

**Removed:**
- `findNearbyTransitStations()` (Google Places Nearby Search)
- `matchToGtfsStop()` (GTFS matching logic)
- `classifyStation()` (Google Places type classification — replaced by `stationTypeFromRouteType`)
- `buildRouteTripsFromGtfs()` (absorbed into scoring loop)

### 3.5 Frontend: Qualifying Stations + Walking Routes

**File:** `app/benchmark/transit/page.tsx`

**Map changes:**
- Remove 0.25mi circle — keep only 0.5mi dashed circle as visual reference
- Station markers: only render `qualifyingStations` (not all nearby)
- Each qualifying station marker uses purple `TrainFront` icon (subway only in this phase)

**Walking route rendering:**
- New `WalkingRoute` component using `useMapsLibrary("routes")`
- For each qualifying station: call `DirectionsService.route()` with `travelMode: WALKING`
- Render result via `DirectionsRenderer` or manual `Polyline` from route steps
- Show walking distance label at route midpoint

**Results panel changes:**
- Show station-by-station scoring breakdown:
  - Station name, walking distance
  - Contributing routes with weekday/weekend trips
  - Running total after each station
  - Final score with threshold match
- Stations that maxed out the score visually distinguished (e.g., "Score reached 4/4 — stopped here")

**Legend update:**
- Remove bus-related legend items
- Show: 0.5mi reference circle, subway icon, walking route line

---

## 4. Data Flow

```
User enters address
        ↓
  [Geocode API] → lat/lng
        ↓
  [GTFS Index] haversine pre-filter (0.75mi)
        ↓
  [Distance Matrix API] batch walking distances
        ↓
  Filter ≤ 0.5mi walking, sort by distance
        ↓
  Station-by-station scoring (nearest first)
  ┌─ Station 1: routes A,B,C → cumulative trips → check threshold
  ├─ Station 2: routes D (A,B,C already counted) → cumulative → check
  └─ ... early stop if score = 4
        ↓
  Response: qualifying stations + score
        ↓
  [Frontend] render qualifying markers + walking routes
```

---

## 5. Files Changed

| File | Change |
|---|---|
| `scripts/preprocess-gtfs.ts` | Add N/S merge step after aggregation |
| `lib/transit-types.ts` | Remove `parentStation` from `StopData`; remove `placeId` from `TransitStation`; update `TransitApiResponse` |
| `lib/transit-scoring.ts` | Rewrite `scoreTransit` for station-by-station accumulation with early termination; update `buildStationResponse` |
| `app/api/transit/route.ts` | Remove Google Places; simplify to GTFS + Distance Matrix; use new scoring |
| `app/benchmark/transit/page.tsx` | Only show qualifying stations; add walking route rendering; update legend and results panel |
| `lib/google-maps.ts` | Remove `QUARTER_MILE_METERS` export (no longer used) |
| `tests/transit-scoring.test.ts` | Update tests for new scoring logic and merged station data |
| `tests/preprocess-gtfs.test.ts` | Add tests for N/S merge logic |

---

## 6. Testing Strategy

- **Unit tests**: N/S merge logic, station-by-station scoring with early termination, route deduplication across stations
- **Integration test**: Known address (e.g., Times Square) → verify correct qualifying stations, trip counts, and score
- **Manual verification**: Compare output against hand-calculated LTc3 score using PDF methodology
