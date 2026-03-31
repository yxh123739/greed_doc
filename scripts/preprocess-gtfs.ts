import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { StopData, StopTripsIndex, StopRouteData } from "@/lib/transit-types";

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
    const groups = new Map<string, number>();

    for (const tripId of tripIdSet) {
      const trip = trips.get(tripId);
      if (!trip) continue;
      const key = `${trip.routeId}|${trip.directionId}|${trip.serviceId}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

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

      const weekdays = [svc.monday, svc.tuesday, svc.wednesday, svc.thursday, svc.friday];
      weekdays.forEach((active, i) => { if (active) d.weekdayPerDay[i] += count; });
      if (svc.saturday) d.weekendPerDay[0] += count;
      if (svc.sunday) d.weekendPerDay[1] += count;
    }

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

export function mergeNSPlatforms(raw: StopTripsIndex): StopTripsIndex {
  const platformGroups = new Map<string, { n?: StopData; s?: StopData }>();
  const passthroughStops: Record<string, StopData> = {};

  for (const [stopId, stop] of Object.entries(raw)) {
    if (stopId.endsWith("N")) {
      const baseId = stopId.slice(0, -1);
      const group = platformGroups.get(baseId) ?? {};
      group.n = stop;
      platformGroups.set(baseId, group);
    } else if (stopId.endsWith("S")) {
      const baseId = stopId.slice(0, -1);
      const group = platformGroups.get(baseId) ?? {};
      group.s = stop;
      platformGroups.set(baseId, group);
    } else {
      passthroughStops[stopId] = stop;
    }
  }

  const merged: StopTripsIndex = { ...passthroughStops };

  for (const [baseId, group] of platformGroups.entries()) {
    if (merged[baseId]) {
      continue;
    }

    const primary = group.n ?? group.s;
    if (!primary) continue;

    const mergedRoutes: Record<string, StopRouteData> = {};
    const routeIds = new Set<string>([
      ...Object.keys(group.n?.routes ?? {}),
      ...Object.keys(group.s?.routes ?? {}),
    ]);

    for (const routeId of routeIds) {
      const nRoute = group.n?.routes[routeId];
      const sRoute = group.s?.routes[routeId];

      if (nRoute && sRoute) {
        mergedRoutes[routeId] = {
          routeName: nRoute.routeName,
          routeType: nRoute.routeType,
          directions: Array.from(new Set([...nRoute.directions, ...sRoute.directions])).sort(
            (a, b) => a - b
          ),
          dir0WeekdayMin: nRoute.dir0WeekdayMin,
          dir0WeekendMax: nRoute.dir0WeekendMax,
          dir1WeekdayMin: sRoute.dir1WeekdayMin,
          dir1WeekendMax: sRoute.dir1WeekendMax,
        };
        continue;
      }

      mergedRoutes[routeId] = (nRoute ?? sRoute)!;
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

  const index: StopTripsIndex = {};
  for (const [stopId, data] of Object.entries(rawAgg)) {
    const stopInfo = stops.get(stopId);
    if (!stopInfo) continue;
    if (stopInfo.locationType === "1") continue;

    index[stopId] = {
      stopName: stopInfo.stopName,
      lat: stopInfo.lat,
      lng: stopInfo.lng,
      routes: data.routes,
    };
  }

  console.log("  Merging N/S platforms...");
  const mergedIndex = mergeNSPlatforms(index);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mergedIndex));

  const stopCount = Object.keys(mergedIndex).length;
  const routeCount = new Set(
    Object.values(mergedIndex).flatMap((s) => Object.keys(s.routes))
  ).size;
  const fileSizeMb = (Buffer.byteLength(JSON.stringify(mergedIndex)) / 1024 / 1024).toFixed(1);

  console.log(`\nDone! Wrote ${OUTPUT_FILE}`);
  console.log(`  ${stopCount} stops, ${routeCount} routes, ${fileSizeMb} MB`);
}

const isDirectRun = process.argv[1]?.endsWith("preprocess-gtfs.ts") ||
                    process.argv[1]?.endsWith("preprocess-gtfs");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Preprocess failed:", err);
    process.exit(1);
  });
}
