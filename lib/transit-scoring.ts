import { haversineDistanceMi } from "@/lib/google-maps";
import {
  TRANSIT_THRESHOLDS,
  maxDistanceForRouteType,
  stationTypeFromRouteType,
  type QualifyingRoute,
  type RouteTrips,
  type ScoredStation,
  type StopData,
  type StopRouteData,
  type StopTripsIndex,
  type TransitScoreResult,
  type TransitStation,
} from "@/lib/transit-types";

// --- Threshold scoring ---

export function calculateTransitScore(
  totalWeekday: number,
  totalWeekend: number
): { points: number; threshold: { weekday: number; weekend: number } | null } {
  for (const threshold of TRANSIT_THRESHOLDS) {
    if (totalWeekday >= threshold.weekday && totalWeekend >= threshold.weekend) {
      return {
        points: threshold.points,
        threshold: {
          weekday: threshold.weekday,
          weekend: threshold.weekend,
        },
      };
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

  return {
    weekdayTrips: Math.min(route.dir0WeekdayMin, route.dir1WeekdayMin),
    weekendTrips: Math.min(route.dir0WeekendMax, route.dir1WeekendMax),
  };
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

export function scoreTransit(stops: ScoredStation[]): TransitScoreResult {
  const countedRoutes = new Set<string>();
  const qualifyingRoutes: QualifyingRoute[] = [];
  const qualifyingStopIds: string[] = [];
  let totalWeekdayTrips = 0;
  let totalWeekendTrips = 0;
  let reachedMaxPoints = false;

  for (const { stopId, stop, walkingDistanceMi } of stops) {
    if (reachedMaxPoints) break;

    let stationContributed = false;

    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      if (reachedMaxPoints) break;
      if (countedRoutes.has(routeId)) continue;

      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (walkingDistanceMi > routeMaxDist) continue;

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

      if (calculateTransitScore(totalWeekdayTrips, totalWeekendTrips).points >= MAX_POINTS) {
        reachedMaxPoints = true;
        break;
      }
    }

    if (stationContributed) {
      qualifyingStopIds.push(stopId);
    }
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
    scoreResult.qualifyingRoutes.map((route) => `${route.routeId}::${route.stopId}`)
  );
  const qualifyingSet = new Set(scoreResult.qualifyingStopIds);

  const allNearbyStations: TransitStation[] = stops
    .map(({ stopId, stop, walkingDistanceMi }) => {
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

      const routeEntries = Object.values(stop.routes);
      const dominantRouteType =
        routeEntries.length > 0
          ? routeEntries.reduce((best, route) =>
              maxDistanceForRouteType(route.routeType) >
              maxDistanceForRouteType(best.routeType)
                ? route
                : best
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
    })
    .filter((station) => station.routes.length > 0);

  const qualifyingStations = allNearbyStations.filter((station) =>
    qualifyingSet.has(station.stopId)
  );

  return { qualifyingStations, allNearbyStations };
}
