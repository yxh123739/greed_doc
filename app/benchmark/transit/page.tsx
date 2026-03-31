"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Circle,
  useMap,
  useMapsLibrary,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { Bus, TrainFront, MapPin, Loader2, ChevronDown } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  QUARTER_MILE_METERS,
  HALF_MILE_METERS,
} from "@/lib/google-maps";
import {
  type TransitStation,
  type TransitApiResponse,
  type RouteTrips,
} from "@/lib/transit-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const DEFAULT_ZOOM = 15;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Legend overlay (top-right of the map) */
function MapLegend() {
  return (
    <div className="absolute right-3 top-3 z-10 rounded-2xl bg-white px-4 py-3 shadow-md">
      <div className="flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 bg-primary" />
        0.25 mi (Bus)
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 border-t-2 border-dashed border-primary" />
        0.5 mi (Subway)
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-orange-500" />
        Bus
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-purple-600" />
        Subway
      </div>
    </div>
  );
}

/** Distance label rendered at the midpoint between project and station */
function DistanceLabel({
  from,
  to,
  distanceMi,
}: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  distanceMi: number;
}) {
  const midpoint = useMemo(
    () => ({
      lat: (from.lat + to.lat) / 2,
      lng: (from.lng + to.lng) / 2,
    }),
    [from, to]
  );

  return (
    <AdvancedMarker position={midpoint} clickable={false}>
      <div className="rounded bg-white px-1.5 py-0.5 text-xs font-bold text-[#4285f4] shadow-sm whitespace-nowrap">
        {distanceMi.toFixed(2)} mi
      </div>
    </AdvancedMarker>
  );
}

/** Station marker with click-to-show info */
function StationMarker({ station }: { station: TransitStation }) {
  const [open, setOpen] = useState(false);
  const isSubway = station.stationType === "subway";
  const Icon = isSubway ? TrainFront : Bus;
  const bgColor = isSubway ? "bg-purple-600" : "bg-orange-500";

  return (
    <>
      <AdvancedMarker
        position={station.location}
        onClick={() => setOpen((v) => !v)}
        title={station.name}
      >
        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${bgColor} shadow-md`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </AdvancedMarker>

      {open && (
        <InfoWindow
          position={station.location}
          onCloseClick={() => setOpen(false)}
        >
          <div className="max-w-[240px] space-y-1 p-1">
            <p className="text-sm font-bold">{station.name}</p>
            <p className="text-xs text-muted-foreground">
              {station.walkingDistanceMi.toFixed(2)} mi walking
            </p>
            {station.routes.length > 0 && (
              <div className="space-y-1 pt-1">
                {station.routes.map((r) => (
                  <div
                    key={r.routeId}
                    className={`flex items-center justify-between gap-2 text-[10px] ${r.counted ? "" : "opacity-50"}`}
                  >
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-bold text-white ${r.counted ? "bg-blue-600" : "bg-gray-400 line-through"}`}
                    >
                      {r.routeName}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {r.weekdayTrips}wd / {r.weekendTrips}we
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

/** Route badges shown near each station on the map */
function StationRouteBadges({ station }: { station: TransitStation }) {
  if (station.routes.length === 0) return null;

  // Offset slightly below the station marker
  const badgePos = {
    lat: station.location.lat - 0.0003,
    lng: station.location.lng,
  };

  return (
    <AdvancedMarker position={badgePos} clickable={false}>
      <div className="flex gap-0.5">
        {station.routes.slice(0, 4).map((r) => (
          <span
            key={r.routeId}
            className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold leading-none shadow ${r.counted ? "bg-blue-600 text-white" : "bg-gray-300 text-gray-500 line-through"}`}
          >
            {r.routeName}
          </span>
        ))}
      </div>
    </AdvancedMarker>
  );
}

/** Auto-fit map bounds to show all markers */
function MapBoundsFitter({
  center,
  stations,
}: {
  center: { lat: number; lng: number };
  stations: TransitStation[];
}) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !coreLib) return;
    if (stations.length === 0) {
      map.setCenter(center);
      map.setZoom(DEFAULT_ZOOM);
      return;
    }
    const bounds = new coreLib.LatLngBounds();
    bounds.extend(center);
    stations.forEach((s) => bounds.extend(s.location));
    map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  }, [map, coreLib, center, stations]);

  return null;
}

// ---------------------------------------------------------------------------
// Transit Map (main map component)
// ---------------------------------------------------------------------------

function TransitMap({
  center,
  stations,
}: {
  center: { lat: number; lng: number };
  stations: TransitStation[];
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-[#DEE2E6] shadow-sm">
      <div className="h-[400px] sm:h-[500px] lg:h-[580px]">
        <Map
          defaultCenter={center}
          defaultZoom={DEFAULT_ZOOM}
          mapId="transit-map"
          gestureHandling="greedy"
          disableDefaultUI={false}
          className="h-full w-full"
        >
          <MapBoundsFitter center={center} stations={stations} />

          {/* 0.5 mi circle (dashed appearance via lower opacity) */}
          <Circle
            center={center}
            radius={HALF_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.5}
            fillColor="#7cb342"
            fillOpacity={0.03}
          />

          {/* 0.25 mi circle (solid) */}
          <Circle
            center={center}
            radius={QUARTER_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.9}
            fillColor="#7cb342"
            fillOpacity={0.07}
          />

          {/* Project marker */}
          <AdvancedMarker position={center} title="Project Location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 shadow-lg ring-2 ring-white">
              <MapPin className="h-5 w-5 text-white" />
            </div>
          </AdvancedMarker>

          {/* Station markers + distance labels + route badges */}
          {stations.map((station) => (
            <StationMarker key={station.placeId} station={station} />
          ))}
          {stations.map((station) => (
            <DistanceLabel
              key={`dist-${station.placeId}`}
              from={center}
              to={station.location}
              distanceMi={station.walkingDistanceMi}
            />
          ))}
          {stations.map((station) => (
            <StationRouteBadges
              key={`routes-${station.placeId}`}
              station={station}
            />
          ))}
        </Map>
      </div>
      <MapLegend />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({
  data,
}: {
  data: TransitApiResponse;
}) {
  const { stations, totalWeekdayTrips, totalWeekendTrips, transitScore } = data;
  const busCount = stations.filter((s) => s.stationType === "bus").length;
  const subwayCount = stations.filter((s) => s.stationType === "subway").length;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white px-6 py-6 text-center shadow-sm">
      <p className="text-lg text-foreground">
        <span className="font-bold">{busCount}</span>{" "}
        <span>bus stations (within 0.25 mi)</span>,{" "}
        <span className="font-bold">{subwayCount}</span>{" "}
        <span>subway stations (within 0.5 mi)</span>
      </p>
      <p className="mt-3 text-5xl font-bold text-primary">
        {stations.length} Transit Stops
      </p>
      <div className="mt-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{totalWeekdayTrips}</span> weekday trips
        </span>
        <span>
          <span className="font-semibold text-foreground">{totalWeekendTrips}</span> weekend trips
        </span>
        <span>
          <span className="font-semibold text-foreground">{transitScore}</span> LEED points
        </span>
      </div>
      <p className="mt-2 text-lg text-muted-foreground">
        Eligible for LEED V5 BD+C, LTc3 Compact and Connected Development
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Station list panel
// ---------------------------------------------------------------------------

function StationListPanel({ stations }: { stations: TransitStation[] }) {
  const [open, setOpen] = useState(false);

  if (stations.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-primary/8 px-5 py-4 sm:px-6"
      >
        <h2 className="text-base font-bold uppercase tracking-[0.04em] text-primary sm:text-[1.15rem]">
          Nearby Transit Stations ({stations.length})
        </h2>
        <ChevronDown
          className={`h-5 w-5 text-primary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="divide-y divide-[#E9ECEF]">
        {stations.map((station) => (
          <div
            key={station.placeId}
            className="flex items-start justify-between gap-4 px-5 py-3 sm:px-6"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                {station.stationType === "subway" ? (
                  <TrainFront className="h-4 w-4 shrink-0 text-purple-600" />
                ) : (
                  <Bus className="h-4 w-4 shrink-0 text-orange-500" />
                )}
                <p className="text-sm font-bold text-foreground">
                  {station.name}
                </p>
              </div>
              {station.routes.length > 0 && (
                <div className="space-y-0.5">
                  {station.routes.map((r) => (
                    <div
                      key={r.routeId}
                      className={`flex items-center gap-2 text-xs ${r.counted ? "" : "opacity-50"}`}
                    >
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${r.counted ? "bg-blue-600" : "bg-gray-400 line-through"}`}
                      >
                        {r.routeName}
                      </span>
                      <span className="text-muted-foreground">
                        {r.weekdayTrips} wd / {r.weekendTrips} we
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span className="shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground">
              {station.walkingDistanceMi.toFixed(2)} mi
            </span>
          </div>
        ))}
      </div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA panel
// ---------------------------------------------------------------------------

function CtaPanel() {
  return (
    <section className="rounded-[18px] bg-primary/5 px-6 py-10 text-center">
      <h2 className="text-3xl font-bold text-foreground">
        Grab Your LEED Docs!
      </h2>
      <p className="mt-2 text-lg text-muted-foreground">
        Everything you need to claim your eligible LEED points, ready to go.
      </p>
      <Button size="lg" className="mt-6 rounded-lg px-10 text-xl font-bold">
        Download
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page content (reads search params)
// ---------------------------------------------------------------------------

function TransitPageContent() {
  const searchParams = useSearchParams();

  const address = searchParams.get("address") ?? "";
  const city = searchParams.get("city") ?? "";
  const stateProvince = searchParams.get("stateProvince") ?? "";
  const zipCode = searchParams.get("zipCode") ?? "";
  const country = searchParams.get("country") ?? "";

  const fullAddress = [address, city, stateProvince, zipCode, country]
    .filter(Boolean)
    .join(", ");

  const [data, setData] = useState<TransitApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransitData = useCallback(async () => {
    if (!address || !city) {
      setError("Address and city are required.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/transit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, city, stateProvince, zipCode, country }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `Request failed (${res.status})`
        );
      }

      const payload: TransitApiResponse = await res.json();
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load transit data."
      );
    } finally {
      setLoading(false);
    }
  }, [address, city, stateProvince, zipCode, country]);

  useEffect(() => {
    fetchTransitData();
  }, [fetchTransitData]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg text-muted-foreground">
          Analyzing transit access...
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-lg font-semibold text-destructive">
          {error ?? "No data available."}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => fetchTransitData()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1140px] space-y-8 px-4 py-8 sm:px-6">
      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          LEED v5 Access to Transit Calculator
        </h1>
        <p className="mt-2 text-base text-muted-foreground sm:text-lg">
          Type in your project address to view eligible LEED v5 credits and
          download the supporting documentation.
        </p>
      </div>

      {/* Address bar */}
      <div className="rounded-lg bg-muted px-5 py-3">
        <p className="text-sm font-medium text-foreground">{fullAddress}</p>
      </div>

      {/* Map */}
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <TransitMap center={data.geocodedLocation} stations={data.stations} />
      </APIProvider>

      {/* Results */}
      <ResultsPanel data={data} />

      {/* Station list */}
      <StationListPanel stations={data.stations} />

      {/* CTA */}
      <CtaPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (with Suspense for useSearchParams)
// ---------------------------------------------------------------------------

export default function TransitPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          }
        >
          <TransitPageContent />
        </Suspense>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Copyright &copy; 2026 Anchor Sustainability LLC. All Rights Reserved.
      </footer>
    </>
  );
}
