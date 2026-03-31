import { haversineDistanceMi } from "@/lib/google-maps";
import {
  TRANSIT_THRESHOLDS,
  maxDistanceForRouteType,
  stationTypeFromRouteType,
  type StopTripsIndex,
  type StopRouteData,
  type QualifyingRoute,
  type TransitScoreResult,
  type TransitStation,
  type RouteTrips,
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

// --- Nearby stop finding ---

interface NearbyStop {
  stopId: string;
  stopName: string;
  lat: number;
  lng: number;
  distanceMi: number;
  dominantRouteType: number;
  routes: Record<string, StopRouteData>;
}

export function findNearbyGtfsStops(
  index: StopTripsIndex,
  center: { lat: number; lng: number }
): NearbyStop[] {
  const results: NearbyStop[] = [];

  for (const [stopId, stop] of Object.entries(index)) {
    const stopLoc = { lat: stop.lat, lng: stop.lng };
    const distMi = haversineDistanceMi(center, stopLoc);

    const routeEntries = Object.values(stop.routes);
    if (routeEntries.length === 0) continue;

    const maxAllowed = Math.max(
      ...routeEntries.map((r) => maxDistanceForRouteType(r.routeType))
    );

    if (distMi > maxAllowed) continue;

    const dominantRouteType = routeEntries.reduce((best, r) =>
      maxDistanceForRouteType(r.routeType) > maxDistanceForRouteType(best.routeType) ? r : best
    ).routeType;

    results.push({
      stopId,
      stopName: stop.stopName,
      lat: stop.lat,
      lng: stop.lng,
      distanceMi: Math.round(distMi * 100) / 100,
      dominantRouteType,
      routes: stop.routes,
    });
  }

  return results.sort((a, b) => a.distanceMi - b.distanceMi);
}

// --- Route deduplication ---

export function deduplicateRoutes(
  candidates: QualifyingRoute[]
): QualifyingRoute[] {
  const bestByRoute = new Map<string, QualifyingRoute>();
  for (const c of candidates) {
    const existing = bestByRoute.get(c.routeId);
    if (!existing || c.weekdayTrips > existing.weekdayTrips) {
      bestByRoute.set(c.routeId, c);
    }
  }
  return Array.from(bestByRoute.values());
}

// --- Full scoring pipeline ---

export function scoreTransit(
  index: StopTripsIndex,
  center: { lat: number; lng: number }
): TransitScoreResult {
  const nearbyStops = findNearbyGtfsStops(index, center);

  const allCandidates: QualifyingRoute[] = [];
  for (const stop of nearbyStops) {
    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (stop.distanceMi > routeMaxDist) continue;

      const trips = computeRouteTrips(routeData);
      if (!trips) continue;

      allCandidates.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        stopId: stop.stopId,
        stopName: stop.stopName,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
      });
    }
  }

  const qualifyingRoutes = deduplicateRoutes(allCandidates);
  const totalWeekdayTrips = qualifyingRoutes.reduce((s, r) => s + r.weekdayTrips, 0);
  const totalWeekendTrips = qualifyingRoutes.reduce((s, r) => s + r.weekendTrips, 0);
  const { points, threshold } = calculateTransitScore(totalWeekdayTrips, totalWeekendTrips);

  return { qualifyingRoutes, totalWeekdayTrips, totalWeekendTrips, points, threshold };
}

// --- Build TransitStation[] for API response ---

export function buildStationResponse(
  index: StopTripsIndex,
  center: { lat: number; lng: number },
  scoreResult: TransitScoreResult
): TransitStation[] {
  const nearbyStops = findNearbyGtfsStops(index, center);
  const countedSet = new Set(
    scoreResult.qualifyingRoutes.map((r) => `${r.routeId}::${r.stopId}`)
  );

  return nearbyStops.map((stop) => {
    const routeTrips: RouteTrips[] = [];
    for (const [routeId, routeData] of Object.entries(stop.routes)) {
      const routeMaxDist = maxDistanceForRouteType(routeData.routeType);
      if (stop.distanceMi > routeMaxDist) continue;

      const trips = computeRouteTrips(routeData);
      if (!trips) continue;

      routeTrips.push({
        routeId,
        routeName: routeData.routeName,
        routeType: routeData.routeType,
        weekdayTrips: trips.weekdayTrips,
        weekendTrips: trips.weekendTrips,
        counted: countedSet.has(`${routeId}::${stop.stopId}`),
      });
    }

    return {
      placeId: stop.stopId, // GTFS-only: use stopId as placeId
      stopId: stop.stopId,
      name: stop.stopName,
      location: { lat: stop.lat, lng: stop.lng },
      walkingDistanceMi: stop.distanceMi,
      stationType: stationTypeFromRouteType(stop.dominantRouteType),
      routes: routeTrips,
    };
  }).filter((s) => s.routes.length > 0);
}
