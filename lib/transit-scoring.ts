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

const MAX_POINTS = 4;

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

// --- Nearby stop finding ---

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
  maxMi = 0.5
): NearbyStop[] {
  const results: NearbyStop[] = [];

  for (const [stopId, stop] of Object.entries(index)) {
    const distanceMi = haversineDistanceMi(center, { lat: stop.lat, lng: stop.lng });
    if (distanceMi > maxMi) continue;

    results.push({
      stopId,
      stopName: stop.stopName,
      lat: stop.lat,
      lng: stop.lng,
      distanceMi: Math.round(distanceMi * 100) / 100,
      routes: stop.routes,
    });
  }

  return results.sort((a, b) => a.distanceMi - b.distanceMi || a.stopId.localeCompare(b.stopId));
}

// --- Station-by-station scoring with early termination ---

function buildRouteTripsForStation(
  stopId: string,
  stop: StopData,
  walkingDistanceMi: number,
  countedSet?: Set<string>
): {
  routeTrips: RouteTrips[];
  dominantRouteType: number | null;
} {
  const routeTrips: RouteTrips[] = [];
  let dominantRouteType: number | null = null;

  for (const [routeId, routeData] of Object.entries(stop.routes)) {
    const routeTripsData = computeRouteTrips(routeData);
    if (!routeTripsData) continue;
    if (walkingDistanceMi > maxDistanceForRouteType(routeData.routeType)) continue;

    routeTrips.push({
      routeId,
      routeName: routeData.routeName,
      routeType: routeData.routeType,
      weekdayTrips: routeTripsData.weekdayTrips,
      weekendTrips: routeTripsData.weekendTrips,
      counted: countedSet ? countedSet.has(`${routeId}::${stopId}`) : false,
    });

    if (
      dominantRouteType === null ||
      maxDistanceForRouteType(routeData.routeType) >
        maxDistanceForRouteType(dominantRouteType)
    ) {
      dominantRouteType = routeData.routeType;
    }
  }

  return { routeTrips, dominantRouteType };
}

export function scoreTransit(stops: ScoredStation[]): TransitScoreResult {
  const countedRouteIds = new Set<string>();
  const qualifyingRoutes: QualifyingRoute[] = [];
  const qualifyingStopIds: string[] = [];
  let totalWeekdayTrips = 0;
  let totalWeekendTrips = 0;

  for (const { stopId, stop, walkingDistanceMi } of stops) {
    let stationContributed = false;

    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      if (countedRouteIds.has(routeId)) continue;
      if (walkingDistanceMi > maxDistanceForRouteType(routeData.routeType)) continue;

      const routeTrips = computeRouteTrips(routeData);
      if (!routeTrips) continue;

      countedRouteIds.add(routeId);
      totalWeekdayTrips += routeTrips.weekdayTrips;
      totalWeekendTrips += routeTrips.weekendTrips;
      stationContributed = true;

      qualifyingRoutes.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        stopId,
        stopName: stop.stopName,
        weekdayTrips: routeTrips.weekdayTrips,
        weekendTrips: routeTrips.weekendTrips,
      });
    }

    if (stationContributed) {
      qualifyingStopIds.push(stopId);
    }

    if (calculateTransitScore(totalWeekdayTrips, totalWeekendTrips).points >= MAX_POINTS) {
      break;
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

export function buildStationList(
  stops: ScoredStation[],
  scoreResult: TransitScoreResult
): { qualifyingStations: TransitStation[]; allNearbyStations: TransitStation[] } {
  const countedSet = new Set(
    scoreResult.qualifyingRoutes.map((route) => `${route.routeId}::${route.stopId}`)
  );
  const qualifyingStopIdSet = new Set(scoreResult.qualifyingStopIds);

  const allNearbyStations = stops
    .map(({ stopId, stop, walkingDistanceMi }) => {
      const { routeTrips, dominantRouteType } = buildRouteTripsForStation(
        stopId,
        stop,
        walkingDistanceMi,
        countedSet
      );

      if (routeTrips.length === 0 || dominantRouteType === null) {
        return null;
      }

      return {
        stopId,
        name: stop.stopName,
        location: { lat: stop.lat, lng: stop.lng },
        walkingDistanceMi,
        stationType: stationTypeFromRouteType(dominantRouteType),
        routes: routeTrips,
      };
    })
    .filter((station): station is TransitStation => station !== null);

  const qualifyingStations = allNearbyStations.filter((station) =>
    qualifyingStopIdSet.has(station.stopId)
  );

  return { qualifyingStations, allNearbyStations };
}

// --- Compatibility helpers ---

export function deduplicateRoutes(candidates: QualifyingRoute[]): QualifyingRoute[] {
  const bestByRoute = new Map<string, QualifyingRoute>();

  for (const candidate of candidates) {
    const existing = bestByRoute.get(candidate.routeId);
    if (!existing || candidate.weekdayTrips > existing.weekdayTrips) {
      bestByRoute.set(candidate.routeId, candidate);
    }
  }

  return Array.from(bestByRoute.values());
}

export function buildStationResponse(
  index: StopTripsIndex,
  center: { lat: number; lng: number },
  scoreResult: TransitScoreResult
): TransitStation[] {
  const nearbyStops = findNearbyGtfsStops(index, center).map((stop) => ({
    stopId: stop.stopId,
    stop: {
      stopName: stop.stopName,
      lat: stop.lat,
      lng: stop.lng,
      routes: stop.routes,
    },
    walkingDistanceMi: stop.distanceMi,
  }));

  return buildStationList(nearbyStops, scoreResult).allNearbyStations;
}
