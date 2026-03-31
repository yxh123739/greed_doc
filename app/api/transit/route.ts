import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { haversineDistanceMi, HALF_MILE_METERS } from "@/lib/google-maps";
import type {
  StopTripsIndex,
  StopData,
  TransitStation,
  TransitApiResponse,
  RouteTrips,
  StationType,
} from "@/lib/transit-types";
import {
  scoreTransit,
  computeRouteTrips,
} from "@/lib/transit-scoring";
import { maxDistanceForRouteType } from "@/lib/transit-types";

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

// --- Station type classification ---

function classifyStation(types: string[]): StationType {
  if (types.includes("subway_station")) return "subway";
  if (types.includes("bus_station")) return "bus";
  return "subway";
}

// --- Places Nearby Search (New API) ---

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  types?: string[];
}

async function findNearbyTransitStations(
  center: { lat: number; lng: number },
  signal: AbortSignal
): Promise<PlaceResult[]> {
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const body = {
    includedTypes: ["transit_station", "bus_station", "subway_station"],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: HALF_MILE_METERS,
      },
    },
  };

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.types",
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = await res.json();
  return data.places ?? [];
}

// --- Walking distance via Distance Matrix API ---

interface WalkingDistanceResult {
  distanceMi: number | null; // null = no walking route found
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
        // value is in meters, convert to miles
        return { distanceMi: el.distance.value / 1609.344 };
      }
    );
  } catch {
    return destinations.map(() => ({ distanceMi: null }));
  }
}

// --- Match Google Places station to nearest GTFS stop ---

const GTFS_MATCH_THRESHOLD_MI = 0.1; // 约160m内匹配

function matchToGtfsStop(
  stationLoc: { lat: number; lng: number },
  index: StopTripsIndex
): { stopId: string; stop: StopData } | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestStop: StopData | null = null;

  for (const [stopId, stop] of Object.entries(index)) {
    const dist = haversineDistanceMi(stationLoc, { lat: stop.lat, lng: stop.lng });
    if (dist < bestDist) {
      bestDist = dist;
      bestId = stopId;
      bestStop = stop;
    }
  }

  if (bestId && bestStop && bestDist <= GTFS_MATCH_THRESHOLD_MI) {
    return { stopId: bestId, stop: bestStop };
  }
  return null;
}

// --- Build route trips from matched GTFS stop ---

function buildRouteTripsFromGtfs(
  stopId: string,
  stop: StopData,
  distMi: number,
  countedSet: Set<string>
): RouteTrips[] {
  const routeTrips: RouteTrips[] = [];
  for (const [routeId, routeData] of Object.entries(stop.routes)) {
    const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
    if (distMi > routeMaxDist) continue;

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
  return routeTrips;
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
        {
          error:
            "Could not geocode this address. Please check and try again.",
        },
        { status: 404 }
      );
    }

    // 2. Score transit using pure GTFS index (authoritative scoring)
    const scoreResult = scoreTransit(index, location);
    const countedSet = new Set(
      scoreResult.qualifyingRoutes.map((r) => `${r.routeId}::${r.stopId}`)
    );

    // 3. Find nearby stations via Google Places (for map display)
    const places = await findNearbyTransitStations(location, signal);

    // 4. Pre-filter places with valid locations
    const candidates = places.flatMap((place) => {
      if (!place.location) return [];
      const stationLoc = {
        lat: place.location.latitude,
        lng: place.location.longitude,
      };
      const stationType = classifyStation(place.types ?? []);
      // Rough haversine pre-filter (generous 0.75mi) to limit Distance Matrix calls
      const roughDist = haversineDistanceMi(location, stationLoc);
      if (roughDist > 0.75) return [];
      return [{ place, stationLoc, stationType }];
    });

    // 5. Batch walking distance via Distance Matrix API
    const walkingResults = await getWalkingDistances(
      location,
      candidates.map((c) => c.stationLoc),
      signal
    );

    // 6. Build station list with walking distances
    const stations: TransitStation[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const { place, stationLoc, stationType } = candidates[i];
      const walkResult = walkingResults[i];

      // Use walking distance; fall back to haversine if API failed
      const distMi =
        walkResult.distanceMi ?? haversineDistanceMi(location, stationLoc);

      // Distance-based filtering: bus ≤ 0.25 mi, subway ≤ 0.5 mi
      const maxDistance = stationType === "bus" ? 0.25 : 0.5;
      if (distMi > maxDistance) continue;

      // Try to match to a GTFS stop for trip data
      const gtfsMatch = matchToGtfsStop(stationLoc, index);

      const routes: RouteTrips[] = gtfsMatch
        ? buildRouteTripsFromGtfs(
            gtfsMatch.stopId,
            gtfsMatch.stop,
            distMi,
            countedSet
          )
        : [];

      stations.push({
        placeId: place.id,
        stopId: gtfsMatch?.stopId,
        name: place.displayName?.text ?? "Transit Station",
        location: stationLoc,
        walkingDistanceMi: Math.round(distMi * 100) / 100,
        stationType,
        routes,
      });
    }

    // Sort by walking distance
    stations.sort((a, b) => a.walkingDistanceMi - b.walkingDistanceMi);

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
