# LTc3 Option 2: Access to Transit — GTFS-Based Scoring

## Context

LEED v5 LTc3 Option 2 (Access to Transit) requires counting weekday and weekend transit trips at nearby stations to earn 1-4 points. Currently the transit page only shows station counts; the benchmark summary page shows placeholder text ("X weekday Trips / Y weekday Trips"). This spec replaces both with real trip counts and scoring, powered by local GTFS data.

## LEED Calculation Rules (from PDF)

1. **Paired service required**: A route must operate in both directions (direction_id 0 and 1) to qualify.
2. **Single direction count**: For each qualifying route, count only the direction with fewer trips.
3. **One stop per route**: If a route serves multiple nearby stops, only the stop with the most trips counts.
4. **Weekday minimum**: Use the weekday with the fewest trips (Mon–Fri).
5. **Weekend maximum**: Use the weekend day with the most trips (Sat or Sun).
6. **Both must meet threshold**: Weekday AND weekend totals must both meet the threshold for a given point level.

### Scoring Thresholds (TABLE 2)

| Weekday Trips | Weekend Trips | Points |
|---------------|---------------|--------|
| 72            | 30            | 1      |
| 132           | 78            | 2      |
| 160           | 120           | 3      |
| 360           | 216           | 4      |

### Station Type Distance Rules

| Type                    | GTFS route_type | Max Distance |
|-------------------------|-----------------|--------------|
| Bus (regular)           | 3               | 0.25 mi      |
| Streetcar               | 0               | 0.25 mi      |
| Bus Rapid Transit (BRT) | 3 (*)           | 0.5 mi       |
| Subway / Heavy Rail     | 1               | 0.5 mi       |
| Rail                    | 2               | 0.5 mi       |
| Light Rail / Tram       | 0               | 0.5 mi       |
| Ferry                   | 4               | 0.5 mi       |

(*) BRT is route_type=3 but with special naming (e.g. "SBS"). For MVP, all route_type=3 use 0.25 mi.

## Architecture

### Module 1: GTFS Preprocessor (`scripts/preprocess-gtfs.ts`)

**Input:** Raw GTFS text files in `public/gtfs_supplemented/`
**Output:** `public/gtfs_supplemented/index/stop-trips.json`

**Steps:**
1. Parse `calendar.txt` → map service_id to day-of-week booleans
2. Parse `calendar_dates.txt` → service exceptions (added/removed dates)
3. Parse `routes.txt` → map route_id to (route_short_name, route_type)
4. Parse `stops.txt` → map stop_id to (name, lat, lng, parent_station, location_type)
5. Parse `trips.txt` → map trip_id to (route_id, service_id, direction_id)
6. Stream `stop_times.txt` → for each stop_id, count unique trip_ids per (route_id, direction_id, service_id)
7. Aggregate: for each stop_id + route_id, compute:
   - weekdayMin: min trips across Mon-Fri (considering service_id schedules)
   - weekendMax: max trips between Sat and Sun
   - Per-direction counts
8. Only include stops with location_type != 1 (exclude parent stations, keep platforms)
9. Write `stop-trips.json`

**`stop-trips.json` schema:**
```typescript
interface StopTripsIndex {
  [stopId: string]: {
    stopName: string;
    lat: number;
    lng: number;
    parentStation: string;
    routes: {
      [routeId: string]: {
        routeName: string;       // route_short_name
        routeType: number;       // GTFS route_type
        directions: number[];    // e.g. [0, 1]
        // Per-direction, per-day-type counts
        dir0WeekdayMin: number;
        dir0WeekendMax: number;
        dir1WeekdayMin: number;
        dir1WeekendMax: number;
      };
    };
  };
}
```

**Run command:** `pnpm run preprocess-gtfs`

### Module 2: LEED Transit Calculator (`lib/transit-scoring.ts`)

Pure functions, no I/O. Consumes the index data and a project location.

```typescript
// Core types
interface QualifyingRoute {
  routeId: string;
  routeName: string;
  routeType: number;
  stopId: string;
  stopName: string;
  weekdayTrips: number;   // min-direction weekday-min
  weekendTrips: number;   // min-direction weekend-max
}

interface TransitScoreResult {
  qualifyingRoutes: QualifyingRoute[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  points: number;          // 0-4
  threshold: { weekday: number; weekend: number } | null;
}
```

**Algorithm:**
1. Filter stops within distance threshold (bus ≤ 0.25 mi, subway ≤ 0.5 mi) using haversine
2. For each nearby stop's routes:
   a. Check paired service: must have both direction 0 and 1
   b. Compute single-direction count: `weekday = min(dir0WeekdayMin, dir1WeekdayMin)`, `weekend = min(dir0WeekendMax, dir1WeekendMax)`
3. Deduplicate: group by routeId across all stops, keep the stop with highest weekday trips
4. Sum weekdayTrips and weekendTrips across all qualifying routes
5. Apply threshold table: find highest tier where both weekday AND weekend meet threshold

### Module 3: Transit API Update (`app/api/transit/route.ts`)

**Changes:**
- Load `stop-trips.json` at startup (cache in module scope)
- Replace Google Places station discovery with GTFS index lookup
- Keep Google Geocoding for address → lat/lng conversion
- Add LEED scoring fields to response

**Updated response type:**
```typescript
interface TransitApiResponse {
  stations: TransitStation[];
  geocodedLocation: { lat: number; lng: number };
  address: string;
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}

interface TransitStation {
  stopId: string;
  name: string;
  location: { lat: number; lng: number };
  walkingDistanceMi: number;
  stationType: StationType;
  routes: RouteTrips[];
}

interface RouteTrips {
  routeId: string;
  routeName: string;
  routeType: number;
  weekdayTrips: number;
  weekendTrips: number;
  counted: boolean;  // false if deduplicated (same route counted at another stop)
}
```

### Module 4: Transit Page UI (`app/benchmark/transit/page.tsx`)

**ResultsPanel changes:**
- Show bus/subway station counts (existing)
- Add total weekday/weekend trips display
- Add LEED points display

**StationListPanel changes:**
- Each station row shows route-level trip breakdown
- Routes marked as `counted: false` shown with strikethrough/grey styling
- Display per-route weekday and weekend trip counts

**Map changes:**
- Station markers now come from GTFS stops (lat/lng from index)
- Marker icons remain: orange=bus, purple=subway
- InfoWindow shows route trips detail

### Module 5: Benchmark Summary Page (`app/benchmark/page.tsx`)

**LTc3 Option 2 section changes:**
- Fetch transit data on the Summary tab (if address is provided)
- Replace "X weekday Trips / Y weekday Trips" with actual values
- Show transit score points
- Include transit score in `totalLTPoints` calculation

**Data flow:**
- Summary tab calls `/api/transit` with the same address data
- On response, update:
  - `transitWeekdayTrips` state
  - `transitWeekendTrips` state
  - `transitScore` state (0-4 points)
- Add `transitScore` to total LT points

## Edge Cases

1. **No GTFS data for the area**: If no stops found within range, show 0 trips / 0 points with a note "No GTFS data available for this location"
2. **Route with only one direction**: Excluded (rule 1: paired service required)
3. **Empty weekend service**: weekendTrips = 0 for that route (e.g. the M5 LTD example in PDF)
4. **Parent station vs. platform stops**: Use platform-level stops (location_type blank) for distance calculation; parent stations (location_type=1) are excluded
5. **Multiple stops sharing parent**: Each platform stop is evaluated independently; the dedup rule (one stop per route) handles overlap
6. **Bus GTFS not yet available**: System shows subway-only results until bus GTFS is added; preprocess script handles any route_type
7. **Preprocess index missing**: API returns 500 with clear error message "GTFS index not found. Run `pnpm run preprocess-gtfs`"

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `scripts/preprocess-gtfs.ts` | Create | GTFS → JSON index preprocessor |
| `lib/transit-scoring.ts` | Create | LEED transit scoring pure functions |
| `lib/google-maps.ts` | Modify | Update types (TransitStation, TransitApiResponse, add RouteTrips) |
| `app/api/transit/route.ts` | Modify | GTFS-based station discovery + scoring |
| `app/benchmark/transit/page.tsx` | Modify | Show trips + points in ResultsPanel/StationListPanel |
| `app/benchmark/page.tsx` | Modify | Integrate transit score into LTc3 Option 2 |
| `package.json` | Modify | Add `preprocess-gtfs` script |

## Verification

1. **Preprocess script**: Run `pnpm run preprocess-gtfs`, verify `stop-trips.json` is created with correct structure
2. **Unit test scoring**: Test `calculateTransitScore()` with known inputs matching PDF example (M5 LTD: 60 weekday, 0 weekend)
3. **API test**: POST to `/api/transit` with NYC address, verify response includes trips and points
4. **Transit page**: Visual check — station markers appear, trip counts shown, points displayed
5. **Benchmark page**: Verify "X weekday Trips" replaced with real numbers, points added to total
6. **Edge case**: Test with address far from any GTFS stops → 0 trips, 0 points
