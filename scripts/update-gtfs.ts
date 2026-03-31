import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import readline from "node:readline";
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
import type { StopTripsIndex, StopData, StopRouteData } from "@/lib/transit-types";

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

async function syncToSupabase(mergedIndex: StopTripsIndex) {
  const supabase = createAdminClient();
  console.log("Cleaning old data...");

  // Supabase JS SDK disallows unconditional DELETE, so we use a
  // never-matching .neq() filter as a workaround to delete all rows.
  // Cascade from gtfs_stops handles gtfs_stop_routes automatically.
  await supabase.from("gtfs_stops").delete().neq("stop_id", "TRUNCATE_HACK");
  await supabase.from("gtfs_routes").delete().neq("route_id", "TRUNCATE_HACK");

  console.log("Preparing DB rows...");
  const stopsRows: { stop_id: string; stop_name: string; lat: number; lng: number }[] = [];
  const stopRoutesRows: { stop_id: string; route_id: string; direction_id: number; weekday_trips_min: number; weekend_trips_max: number }[] = [];
  const routesMap = new Map<string, { route_id: string; route_name: string; route_type: number }>();

  for (const [stopId, stopData] of Object.entries(mergedIndex)) {
    const { stopName, lat, lng, routes } = stopData;
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
    const { error } = await supabase.from("gtfs_routes").insert(routesArr.slice(i, i + 500));
    if (error) throw error;
  }

  console.log(`Inserting ${stopsRows.length} stops...`);
  for (let i = 0; i < stopsRows.length; i += 500) {
    const { error } = await supabase.from("gtfs_stops").insert(stopsRows.slice(i, i + 500));
    if (error) throw error;
  }

  console.log(`Inserting ${stopRoutesRows.length} stop_routes...`);
  for (let i = 0; i < stopRoutesRows.length; i += 1000) {
    const { error } = await supabase.from("gtfs_stop_routes").insert(stopRoutesRows.slice(i, i + 1000));
    if (error) throw error;
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
  const index: StopTripsIndex = {};
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
