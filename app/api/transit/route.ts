import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { buildStationList, findNearbyGtfsStops, scoreTransit } from "@/lib/transit-scoring";
import type {
  ScoredStation,
  StopTripsIndex,
  TransitApiResponse,
} from "@/lib/transit-types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// --- GTFS index (cached at module level) ---

let gtfsIndex: StopTripsIndex | null = null;
function getGtfsIndex(): StopTripsIndex {
  if (!gtfsIndex) {
    const indexPath = join(process.cwd(), "public/gtfs_supplemented/index/stop-trips.json");
    try {
      gtfsIndex = JSON.parse(readFileSync(indexPath, "utf-8")) as StopTripsIndex;
    } catch {
      throw new Error("GTFS index not found. Run `pnpm run preprocess-gtfs` first.");
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
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
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

  const response = await fetchWithRetry(url, { signal });
  const data = await response.json();

  if (data.status !== "OK" || !data.results?.length) return null;

  const location = data.results[0].geometry.location;
  return { lat: location.lat, lng: location.lng };
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

  const originParam = `${origin.lat},${origin.lng}`;
  const destinationParam = destinations.map((destination) => `${destination.lat},${destination.lng}`).join("|");

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originParam}&destinations=${destinationParam}&mode=walking&units=imperial&key=${API_KEY}`;

  try {
    const response = await fetchWithRetry(url, { signal });
    const data = await response.json();

    if (data.status !== "OK" || !data.rows?.[0]?.elements) {
      return destinations.map(() => ({ distanceMi: null }));
    }

    return data.rows[0].elements.map(
      (element: { status: string; distance?: { value: number } }) => {
        if (element.status !== "OK" || !element.distance) return { distanceMi: null };
        return { distanceMi: element.distance.value / 1609.344 };
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
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  try {
    const payload = (await req.json()) as TransitPayload;

    const address = payload.address?.trim() ?? "";
    const city = payload.city?.trim() ?? "";
    const stateProvince = payload.stateProvince?.trim() ?? "";
    const zipCode = payload.zipCode?.trim() ?? "";
    const country = payload.country?.trim() ?? "";

    if (!address || !city) {
      return NextResponse.json({ error: "Address and city are required." }, { status: 400 });
    }

    const fullAddress = [address, city, stateProvince, zipCode, country]
      .filter(Boolean)
      .join(", ");
    const signal = AbortSignal.timeout(30_000);

    const location = await geocodeAddress(fullAddress, signal);
    if (!location) {
      return NextResponse.json(
        { error: "Could not geocode this address. Please check and try again." },
        { status: 404 }
      );
    }

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

    const walkingResults = await getWalkingDistances(
      location,
      nearbyCandidates.map((candidate) => ({ lat: candidate.lat, lng: candidate.lng })),
      signal
    );

    const scoredStops: ScoredStation[] = nearbyCandidates
      .map((candidate, indexOffset) => {
        const fallbackDistance = candidate.distanceMi;
        const matrixDistance = walkingResults[indexOffset]?.distanceMi ?? fallbackDistance;

        return {
          stopId: candidate.stopId,
          stop: index[candidate.stopId],
          walkingDistanceMi: Math.round(matrixDistance * 100) / 100,
        };
      })
      .filter((stop) => stop.stop !== undefined)
      .filter((stop) => stop.walkingDistanceMi <= 0.5)
      .sort((a, b) => a.walkingDistanceMi - b.walkingDistanceMi);

    const scoreResult = scoreTransit(scoredStops);
    const { qualifyingStations, allNearbyStations } = buildStationList(scoredStops, scoreResult);

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
    return NextResponse.json({ error: "Failed to fetch transit data." }, { status: 500 });
  }
}
