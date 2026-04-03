# GTFS Data Migration to Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate GTFS transit data from a static JSON file to Supabase tables, and build a script to automatically download and sync monthly updates from S3.

**Architecture:** We will create three new tables (`gtfs_stops`, `gtfs_routes`, `gtfs_stop_routes`) to store the preprocessed data. The existing `preprocess-gtfs.ts` logic will be extracted into a library and reused by a new `update-gtfs.ts` script that pulls the `gtfs_supplemented` ZIP from S3, processes it, truncates the tables, and inserts the fresh data via a service-role Supabase client. Finally, the API endpoint will be updated to query the database instead of reading the local JSON file.

**Tech Stack:** Next.js API Routes, Supabase (PostgreSQL), TypeScript, `unzipper` (for S3 ZIP processing)

---

### Task 1: Update Supabase Schema and Client

**Files:**
- Modify: `lib/supabase/schema.sql`
- Modify: `lib/supabase/client.ts`
- Create: `supabase/migrations/20260331000000_add_gtfs_tables.sql` (if using local migrations, or just apply via dashboard. We'll add the script to apply it).

- [ ] **Step 1: Define the GTFS tables in the schema**
  Modify `lib/supabase/schema.sql` to append the new tables and RLS policies at the bottom.
  ```sql
  -- GTFS Transit Data Tables

  create table if not exists public.gtfs_stops (
    stop_id text primary key,
    stop_name text not null,
    lat numeric not null,
    lng numeric not null
  );

  create table if not exists public.gtfs_routes (
    route_id text primary key,
    route_name text not null,
    route_type integer not null
  );

  create table if not exists public.gtfs_stop_routes (
    stop_id text references public.gtfs_stops(stop_id) on delete cascade,
    route_id text references public.gtfs_routes(route_id) on delete cascade,
    direction_id integer not null,
    weekday_trips_min integer not null,
    weekend_trips_max integer not null,
    primary key (stop_id, route_id, direction_id)
  );

  -- RLS Policies (Public Read, Service Role Write)
  alter table public.gtfs_stops enable row level security;
  alter table public.gtfs_routes enable row level security;
  alter table public.gtfs_stop_routes enable row level security;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='gtfs_stops_select_all') THEN
      CREATE POLICY gtfs_stops_select_all ON public.gtfs_stops FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='gtfs_routes_select_all') THEN
      CREATE POLICY gtfs_routes_select_all ON public.gtfs_routes FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='gtfs_stop_routes_select_all') THEN
      CREATE POLICY gtfs_stop_routes_select_all ON public.gtfs_stop_routes FOR SELECT USING (true);
    END IF;
  END$$;
  ```

- [ ] **Step 2: Add Admin (Service Role) Client capability**
  Modify `lib/supabase/client.ts` to export a `createAdminClient` function for scripts.
  ```typescript
  export const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  export function createAdminClient() {
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    return createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  ```

- [ ] **Step 3: Apply Schema to Supabase**
  Run the SQL against your project database to create the tables. Note: If working locally, you can use the MCP Supabase tool (`mcp__supabase__execute_sql` or `mcp__supabase__apply_migration`) to execute the SQL block above.

- [ ] **Step 4: Commit**
  ```bash
  git add lib/supabase
  git commit -m "feat: add GTFS tables to schema and admin client generator"
  ```

### Task 2: Refactor Preprocess Script

**Files:**
- Modify: `scripts/preprocess-gtfs.ts`

- [ ] **Step 1: Abstract parsing to accept strings instead of reading files**
  The current script uses `streamStopTimes`. We need to export a memory-based or generic stream parser so `update-gtfs.ts` can pass it data unzipped from memory/disk.
  Modify `streamStopTimes` in `scripts/preprocess-gtfs.ts` to accept an async iterable (or readable stream) of lines instead of a file path, so it can be used with both local files and unzipped streams.
  ```typescript
  export async function streamStopTimesLines(
    lines: AsyncIterable<string>,
    trips: Map<string, TripInfo>
  ): Promise<Map<string, Set<string>>> {
    const stopTrips = new Map<string, Set<string>>();
    let isHeader = true;
    let tripIdCol = 0;
    let stopIdCol = 1;

    for await (const line of lines) {
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
      if (!trips.has(tripId)) continue;

      let set = stopTrips.get(stopId);
      if (!set) {
        set = new Set();
        stopTrips.set(stopId, set);
      }
      set.add(tripId);
    }
    return stopTrips;
  }
  ```
  And update the local `streamStopTimes` to use it:
  ```typescript
  async function streamStopTimes(filePath: string, trips: Map<string, TripInfo>) {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    return streamStopTimesLines(rl, trips);
  }
  ```

- [ ] **Step 2: Export parsing helpers**
  Ensure `parseStops`, `parseCalendar`, `parseRoutes`, `parseTrips`, `aggregateStopTrips`, and `mergeNSPlatforms` are exported so `update-gtfs.ts` can import them. (Most are already exported, just ensure `parseStops` is exported too).

- [ ] **Step 3: Test local script still works**
  Run: `pnpm run preprocess-gtfs`
  Expected: Completes successfully and generates `stop-trips.json`.

- [ ] **Step 4: Commit**
  ```bash
  git add scripts/preprocess-gtfs.ts
  git commit -m "refactor: abstract GTFS parsing to support stream inputs"
  ```

### Task 3: Build GTFS Update Script

**Files:**
- Create: `scripts/update-gtfs.ts`
- Modify: `package.json`

- [ ] **Step 1: Install `unzipper`**
  Run: `pnpm add -D unzipper @types/unzipper p-limit dotenv` (using `p-limit` for batched inserts and `dotenv` for running script locally)

- [ ] **Step 2: Write `scripts/update-gtfs.ts` download & parse logic**
  Create heavily-commented script.
  ```typescript
  import fs from "node:fs";
  import path from "node:path";
  import { pipeline } from "node:stream/promises";
  import unzipper from "unzipper";
  import readline from "node:readline";
  import pLimit from "p-limit";
  import dotenv from "dotenv";
  // Verify correct relative import path in your project
  import { createAdminClient } from "../lib/supabase/client";
  import {
    parseCalendar,
    parseRoutes,
    parseTrips,
    parseStops,
    aggregateStopTrips,
    mergeNSPlatforms,
    streamStopTimesLines
  } from "./preprocess-gtfs";

  dotenv.config({ path: ".env.local" });

  const S3_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip";
  const TEMP_DIR = path.resolve(process.cwd(), ".gtfs-temp");

  async function downloadAndExtract() {
    console.log(`Downloading ${S3_URL}...`);
    const response = await fetch(S3_URL);
    if (!response.ok || !response.body) throw new Error("Failed to download ZIP");

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const zipPath = path.join(TEMP_DIR, "gtfs.zip");

    const fileStream = fs.createWriteStream(zipPath);
    // Node.js 18+ syntax
    await pipeline(response.body as any, fileStream);

    console.log("Extracting...");
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: TEMP_DIR }))
        .on("close", resolve)
        .on("error", reject);
    });
  }

  // Script continues below...
  ```

- [ ] **Step 3: Write DB Synchronization logic in `update-gtfs.ts`**
  ```typescript
  async function syncToSupabase(mergedIndex: any) {
    const supabase = createAdminClient();
    console.log("Cleaning old data...");

    // Note: Since you mentioned truncating in a transaction isn't strictly necessary for a manual script at 3AM,
    // we delete to trigger cascade. Or execute raw SQL.
    const { error: delErr } = await supabase.rpc('truncate_gtfs_tables');
    // If you don't want to define an RPC, you can just delete via REST (note: requires where filter for safety in Supabase JS, or delete all using id map)
    // Actually, safer is to delete from stops (cascades to stop_routes) then routes.
    await supabase.from("gtfs_stops").delete().neq("stop_id", "TRUNCATE_HACK");
    await supabase.from("gtfs_routes").delete().neq("route_id", "TRUNCATE_HACK");

    console.log("Preparing DB rows...");
    const stopsRows: any[] = [];
    const stopRoutesRows: any[] = [];
    const routesMap = new Map();

    for (const [stopId, stopData] of Object.entries(mergedIndex)) {
      const { stopName, lat, lng, routes } = stopData as any;
      stopsRows.push({ stop_id: stopId, stop_name: stopName, lat, lng });

      for (const [routeId, routeData] of Object.entries(routes)) {
        routesMap.set(routeId, {
          route_id: routeId,
          route_name: routeData.routeName,
          route_type: routeData.routeType,
        });

        for (const dir of routeData.directions) {
          const weekdayMin = dir === 0 ? routeData.dir0WeekdayMin : routeData.dir1WeekdayMin;
          const weekendMax = dir === 0 ? routeData.dir0WeekendMax : routeData.dir1WeekendMax;
          stopRoutesRows.push({
            stop_id: stopId,
            route_id: routeId,
            direction_id: dir,
            weekday_trips_min: weekdayMin,
            weekend_trips_max: weekendMax,
          });
        }
      }
    }

    console.log(`Inserting ${routesMap.size} routes...`);
    const routesArr = Array.from(routesMap.values());
    for (let i = 0; i < routesArr.length; i += 500) {
      await supabase.from("gtfs_routes").insert(routesArr.slice(i, i + 500)).throwOnError();
    }

    console.log(`Inserting ${stopsRows.length} stops...`);
    for (let i = 0; i < stopsRows.length; i += 500) {
      await supabase.from("gtfs_stops").insert(stopsRows.slice(i, i + 500)).throwOnError();
    }

    console.log(`Inserting ${stopRoutesRows.length} stop_routes...`);
    for (let i = 0; i < stopRoutesRows.length; i += 1000) {
      await supabase.from("gtfs_stop_routes").insert(stopRoutesRows.slice(i, i + 1000)).throwOnError();
    }
  }

  async function main() {
    await downloadAndExtract();

    const readTxt = (name: string) => fs.readFileSync(path.join(TEMP_DIR, name), "utf-8");
    const calendar = parseCalendar(readTxt("calendar.txt"));
    const routes = parseRoutes(readTxt("routes.txt"));
    const trips = parseTrips(readTxt("trips.txt"));
    const stops = parseStops(readTxt("stops.txt"));

    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(TEMP_DIR, "stop_times.txt")),
      crlfDelay: Infinity,
    });
    const stopTimeTripIds = await streamStopTimesLines(rl, trips);

    const rawAgg = aggregateStopTrips(stopTimeTripIds, trips, calendar, routes);
    const index: any = {};
    for (const [stopId, data] of Object.entries(rawAgg)) {
      const stopInfo = stops.get(stopId);
      if (stopInfo && stopInfo.locationType !== "1") {
        index[stopId] = {
          stopName: stopInfo.stopName, lat: stopInfo.lat, lng: stopInfo.lng, routes: data.routes,
        };
      }
    }
    const mergedIndex = mergeNSPlatforms(index);

    await syncToSupabase(mergedIndex);

    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log("Update complete!");
  }

  main().catch(console.error);
  ```

- [ ] **Step 4: Update `package.json`**
  Modify `"scripts"` to include `"update-gtfs": "tsx scripts/update-gtfs.ts"`.

- [ ] **Step 5: Run Script**
  Ensure your `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  Run: `pnpm run update-gtfs`
  Verify that data appears in your Supabase project (you can use `mcp__supabase__execute_sql` with `SELECT COUNT(*) FROM gtfs_stops;` to check there are ~496 rows).

- [ ] **Step 6: Commit**
  ```bash
  git add package.json scripts/update-gtfs.ts
  git commit -m "feat: add S3 download and Supabase sync script for GTFS"
  ```

### Task 4: Modify Transit API Route

**Files:**
- Modify: `app/api/transit/route.ts`

- [ ] **Step 1: Replace file reading with Supabase querying**
  Remove `fs`, `path`, and local JSON loading logic. Use `supabase` client.
  ```typescript
  import { supabase } from "@/lib/supabase/client";
  import { buildStationList, findNearbyGtfsStops, scoreTransit } from "@/lib/transit-scoring";
  import type { StopTripsIndex, TransitApiResponse, StopData, StopRouteData } from "@/lib/transit-types";

  const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  async function fetchGtfsIndexFromDb(): Promise<StopTripsIndex> {
    const { data: stopsData, error: stopsErr } = await supabase.from("gtfs_stops").select("*");
    if (stopsErr) throw stopsErr;

    const { data: stopRoutesData, error: routesErr } = await supabase
      .from("gtfs_stop_routes")
      .select("*, gtfs_routes(*)");
    if (routesErr) throw routesErr;

    const index: StopTripsIndex = {};

    // Initialize stops
    for (const s of stopsData) {
      index[s.stop_id] = {
        stopName: s.stop_name,
        lat: Number(s.lat),
        lng: Number(s.lng),
        routes: {},
      };
    }

    // Populate routes
    for (const sr of stopRoutesData) {
      const stop = index[sr.stop_id];
      if (!stop) continue;

      const routeId = sr.route_id;
      const routeInfo = sr.gtfs_routes;

      if (!stop.routes[routeId]) {
        stop.routes[routeId] = {
          routeName: routeInfo.route_name,
          routeType: routeInfo.route_type,
          directions: [],
          dir0WeekdayMin: 0,
          dir0WeekendMax: 0,
          dir1WeekdayMin: 0,
          dir1WeekendMax: 0,
        };
      }

      const r = stop.routes[routeId];
      r.directions.push(sr.direction_id);
      r.directions.sort();

      if (sr.direction_id === 0) {
        r.dir0WeekdayMin = sr.weekday_trips_min;
        r.dir0WeekendMax = sr.weekend_trips_max;
      } else if (sr.direction_id === 1) {
        r.dir1WeekdayMin = sr.weekday_trips_min;
        r.dir1WeekendMax = sr.weekend_trips_max;
      }
    }

    return index;
  }
  ```

- [ ] **Step 2: Update POST handler to call `fetchGtfsIndexFromDb()`**
  ```typescript
  export async function POST(req: NextRequest) {
    if (!API_KEY) {
      return NextResponse.json({ error: "Google Maps API key is not configured." }, { status: 500 });
    }

    let index: StopTripsIndex;
    try {
      index = await fetchGtfsIndexFromDb();
    } catch (error) {
      return NextResponse.json({ error: "Failed to load GTFS base data." }, { status: 500 });
    }
    // Rest of code remains completely unchanged
  ```

- [ ] **Step 3: Test API locally**
  Start `pnpm run dev`. Hit the transit endpoint from the frontend browser tab or using cURL. Ensure it returns the expected scores (X / 4 Points) as it did with the local JSON file.

- [ ] **Step 4: Commit**
  ```bash
  git add app/api/transit/route.ts
  git commit -m "feat: transit API reads from Supabase instead of JSON file"
  ```

### Task 5: Cleanup

**Files:**
- Remove: `public/gtfs_supplemented/index/stop-trips.json`
- Remove: `/public/gtfs_supplemented` (the entire unzipped directory is no longer required unless used for something else)

- [ ] **Step 1: Delete static JSON cache**
  Delete the folders to ensure no local state is accidentally relied upon:
  ```bash
  rm -rf public/gtfs_supplemented
  ```

- [ ] **Step 2: Commit**
  ```bash
  git rm -rf public/gtfs_supplemented
  git commit -m "cleanup: remove local static GTFS JSON index"
  ```

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-31-gtfs-supabase-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**