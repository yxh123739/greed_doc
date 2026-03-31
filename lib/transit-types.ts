// lib/transit-types.ts

// --- GTFS Index Types (output of preprocess script) ---

export interface StopRouteData {
  routeName: string;
  routeType: number;
  directions: number[];
  dir0WeekdayMin: number;
  dir0WeekendMax: number;
  dir1WeekdayMin: number;
  dir1WeekendMax: number;
}

export interface StopData {
  stopName: string;
  lat: number;
  lng: number;
  routes: Record<string, StopRouteData>;
}

export type StopTripsIndex = Record<string, StopData>;

// --- API Response Types ---

export type StationType = "bus" | "subway";

export interface RouteTrips {
  routeId: string;
  routeName: string;
  routeType: number;
  weekdayTrips: number;
  weekendTrips: number;
  counted: boolean;
}

export interface TransitStation {
  stopId: string;
  name: string;
  location: { lat: number; lng: number };
  walkingDistanceMi: number;
  stationType: StationType;
  routes: RouteTrips[];
}

export interface TransitApiResponse {
  qualifyingStations: TransitStation[];
  allNearbyStations: TransitStation[];
  geocodedLocation: { lat: number; lng: number };
  address: string;
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}

// --- Scoring Types ---

export interface QualifyingRoute {
  routeId: string;
  routeName: string;
  routeType: number;
  stopId: string;
  stopName: string;
  weekdayTrips: number;
  weekendTrips: number;
}

export interface TransitScoreResult {
  qualifyingRoutes: QualifyingRoute[];
  qualifyingStopIds: string[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  points: number;
  threshold: { weekday: number; weekend: number } | null;
}

export interface ScoredStation {
  stopId: string;
  stop: StopData;
  walkingDistanceMi: number;
}

// --- Constants ---

export const TRANSIT_THRESHOLDS = [
  { weekday: 360, weekend: 216, points: 4 },
  { weekday: 160, weekend: 120, points: 3 },
  { weekday: 132, weekend: 78, points: 2 },
  { weekday: 72, weekend: 30, points: 1 },
] as const;

/**
 * Max walking distance in miles by GTFS route_type.
 * route_type 3 (bus) and 0 (streetcar) = 0.25 mi; everything else = 0.5 mi.
 */
export function maxDistanceForRouteType(routeType: number): number {
  return routeType === 3 || routeType === 0 ? 0.25 : 0.5;
}

/**
 * Map GTFS route_type to display StationType.
 */
export function stationTypeFromRouteType(routeType: number): StationType {
  return routeType === 3 || routeType === 0 ? "bus" : "subway";
}
