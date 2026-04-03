"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { ChevronDown, Loader2, MapPin } from "lucide-react";
import Image from "next/image";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { HALF_MILE_METERS } from "@/lib/google-maps";
import type { TransitApiResponse, TransitStation } from "@/lib/transit-types";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const DEFAULT_ZOOM = 15;
const WALKING_ROUTE_COLORS = ["#4285f4", "#34a853", "#ea4335", "#fbbc04", "#9c27b0"];

function MapLegend() {
  return (
    <div className="absolute right-3 top-3 z-10 rounded-2xl bg-white px-4 py-3 shadow-md">
      <div className="flex items-center gap-2 text-xs font-bold">
        <span className="inline-block h-0.5 w-8 border-t-2 border-dashed border-[#7cb342]" />
        0.5 mi reference
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="inline-block h-3 w-3 rounded-full bg-purple-600" />
        Qualifying Subway Station
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="inline-block h-0.5 w-8 bg-[#4285f4]" />
        Walking Route
      </div>
    </div>
  );
}

function WalkingRoute({
  origin,
  destination,
  color,
}: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  color: string;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const rendererRef = useRef<any>(null);

  useEffect(() => {
    if (!map || !routesLib) return;

    const service = new routesLib.DirectionsService();
    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.8,
      },
    });

    rendererRef.current = renderer;

    service.route(
      {
        origin,
        destination,
        travelMode: "WALKING",
      },
      (result: any, status: string) => {
        if (status === "OK" && result) {
          renderer.setDirections(result);
        }
      }
    );

    return () => {
      renderer.setMap(null);
      rendererRef.current = null;
    };
  }, [color, destination, map, origin, routesLib]);

  return null;
}

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
      <div className="whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-xs font-bold text-[#4285f4] shadow-sm">
        {distanceMi.toFixed(2)} mi
      </div>
    </AdvancedMarker>
  );
}

function StationMarker({ station }: { station: TransitStation }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <AdvancedMarker
        position={station.location}
        onClick={() => setOpen((value) => !value)}
        title={station.name}
      >
        <Image src="/subway.png" alt="subway" width={40} height={40} className="drop-shadow-md" />
      </AdvancedMarker>

      {open && (
        <InfoWindow position={station.location} onCloseClick={() => setOpen(false)}>
          <div className="max-w-[240px] space-y-1 p-1">
            <p className="text-sm font-bold">{station.name}</p>
            <p className="text-xs text-muted-foreground">
              {station.walkingDistanceMi.toFixed(2)} mi walking
            </p>
            {station.routes.length > 0 && (
              <div className="space-y-1 pt-1">
                {station.routes.map((route) => (
                  <div
                    key={route.routeId}
                    className={`flex items-center justify-between gap-2 text-[10px] ${
                      route.counted ? "" : "opacity-50"
                    }`}
                  >
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-bold text-white ${
                        route.counted ? "bg-blue-600" : "bg-gray-400 line-through"
                      }`}
                    >
                      {route.routeName}
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {route.weekdayTrips}wd / {route.weekendTrips}we
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

function StationRouteBadges({ station }: { station: TransitStation }) {
  if (station.routes.length === 0) return null;

  const badgePos = {
    lat: station.location.lat - 0.0003,
    lng: station.location.lng,
  };

  return (
    <AdvancedMarker position={badgePos} clickable={false}>
      <div className="flex gap-[3px]">
        {station.routes.slice(0, 6).map((route) => (
          <div
            key={route.routeId}
            className={`h-3 w-3 rounded-full ${
              route.counted ? "bg-blue-600" : "bg-gray-300"
            }`}
          />
        ))}
      </div>
    </AdvancedMarker>
  );
}

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
    stations.forEach((station) => bounds.extend(station.location));
    map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  }, [center, coreLib, map, stations]);

  return null;
}

function TransitMap({
  center,
  qualifyingStations,
}: {
  center: { lat: number; lng: number };
  qualifyingStations: TransitStation[];
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
          <MapBoundsFitter center={center} stations={qualifyingStations} />

          <Circle
            center={center}
            radius={HALF_MILE_METERS}
            strokeColor="#7cb342"
            strokeWeight={2}
            strokeOpacity={0.5}
            fillColor="#7cb342"
            fillOpacity={0.03}
          />

          <AdvancedMarker position={center} title="Project Location">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 shadow-lg ring-2 ring-white">
              <MapPin className="h-5 w-5 text-white" />
            </div>
          </AdvancedMarker>

          {qualifyingStations.map((station, index) => (
            <WalkingRoute
              key={`walk-${station.stopId}`}
              origin={center}
              destination={station.location}
              color={WALKING_ROUTE_COLORS[index % WALKING_ROUTE_COLORS.length]}
            />
          ))}

          {qualifyingStations.map((station) => (
            <StationMarker key={station.stopId} station={station} />
          ))}
          {qualifyingStations.map((station) => (
            <DistanceLabel
              key={`dist-${station.stopId}`}
              from={center}
              to={station.location}
              distanceMi={station.walkingDistanceMi}
            />
          ))}
          {qualifyingStations.map((station) => (
            <StationRouteBadges key={`routes-${station.stopId}`} station={station} />
          ))}
        </Map>
      </div>
      <MapLegend />
    </div>
  );
}

function ResultsPanel({ data }: { data: TransitApiResponse }) {
  const { qualifyingStations, totalWeekdayTrips, totalWeekendTrips, transitScore } = data;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white px-6 py-6 text-center shadow-sm">
      <p className="text-lg text-foreground">
        <span className="font-bold">{qualifyingStations.length}</span> qualifying subway
        station{qualifyingStations.length !== 1 ? "s" : ""} (within 0.5 mi walking)
      </p>
      <p className="mt-3 text-5xl font-bold text-primary">{transitScore} / 4 Points</p>
      <div className="mt-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{totalWeekdayTrips}</span> weekday trips
        </span>
        <span>
          <span className="font-semibold text-foreground">{totalWeekendTrips}</span> weekend trips
        </span>
      </div>
      <p className="mt-2 text-lg text-muted-foreground">
        LEED v5 BD+C, LTc3 Access to Transit (Option 2)
      </p>
    </section>
  );
}

function ScoringBreakdown({ data }: { data: TransitApiResponse }) {
  const [open, setOpen] = useState(true);
  const { qualifyingStations } = data;

  if (qualifyingStations.length === 0) return null;

  let runningWeekday = 0;
  let runningWeekend = 0;

  return (
    <section className="overflow-hidden rounded-[18px] border border-[#DEE2E6] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between bg-primary/8 px-5 py-4 sm:px-6"
      >
        <h2 className="text-base font-bold uppercase tracking-[0.04em] text-primary sm:text-[1.15rem]">
          Scoring Breakdown ({qualifyingStations.length} station
          {qualifyingStations.length !== 1 ? "s" : ""})
        </h2>
        <ChevronDown
          className={`h-5 w-5 text-primary transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="divide-y divide-[#E9ECEF]">
          {qualifyingStations.map((station, index) => {
            const stationWeekday = station.routes
              .filter((route) => route.counted)
              .reduce((sum, route) => sum + route.weekdayTrips, 0);
            const stationWeekend = station.routes
              .filter((route) => route.counted)
              .reduce((sum, route) => sum + route.weekendTrips, 0);
            runningWeekday += stationWeekday;
            runningWeekend += stationWeekend;

            return (
              <div key={station.stopId} className="px-5 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <Image src="/subway.png" alt="subway" width={16} height={16} />
                    <span className="font-bold text-foreground">{station.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {station.walkingDistanceMi.toFixed(2)} mi
                  </span>
                </div>
                <div className="mt-2 space-y-1 pl-8">
                  {station.routes
                    .filter((route) => route.counted)
                    .map((route) => (
                      <div key={route.routeId} className="flex items-center gap-2 text-xs">
                        <span className="inline-block rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {route.routeName}
                        </span>
                        <span className="text-muted-foreground">
                          +{route.weekdayTrips} wd / +{route.weekendTrips} we
                        </span>
                      </div>
                    ))}
                </div>
                <div className="mt-2 pl-8 text-xs text-muted-foreground">
                  Running total:{" "}
                  <span className="font-semibold text-foreground">{runningWeekday}</span> weekday,{" "}
                  <span className="font-semibold text-foreground">{runningWeekend}</span> weekend
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CtaPanel({ data }: { data: TransitApiResponse }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const response = await fetch("/api/transit/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: searchParams.get("address") ?? "",
          city: searchParams.get("city") ?? "",
          stateProvince: searchParams.get("stateProvince") ?? "",
          zipCode: searchParams.get("zipCode") ?? "",
          country: searchParams.get("country") ?? "",
          geocodedLocation: data.geocodedLocation,
          qualifyingStations: data.qualifyingStations,
          totalWeekdayTrips: data.totalWeekdayTrips,
          totalWeekendTrips: data.totalWeekendTrips,
          transitScore: data.transitScore,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          (errorBody as { error?: string }).error ?? `Download failed (${response.status})`
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "LEED-Transit-Report.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      const { toast } = await import("sonner");
      toast(error instanceof Error ? error.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-[18px] bg-primary/5 px-6 py-10 text-center">
      <h2 className="text-3xl font-bold text-foreground">Grab Your LEED Docs!</h2>
      <p className="mt-2 text-lg text-muted-foreground">
        Everything you need to claim your eligible LEED points, ready to go.
      </p>
      <Button
        size="lg"
        className="mt-6 rounded-lg px-10 text-xl font-bold"
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Generating report...
          </>
        ) : (
          "Download"
        )}
      </Button>
    </section>
  );
}

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
      const response = await fetch("/api/transit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, city, stateProvince, zipCode, country }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          (errorBody as { error?: string }).error ?? `Request failed (${response.status})`
        );
      }

      const payload: TransitApiResponse = await response.json();
      setData(payload);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Failed to load transit data."
      );
    } finally {
      setLoading(false);
    }
  }, [address, city, country, stateProvince, zipCode]);

  useEffect(() => {
    fetchTransitData();
  }, [fetchTransitData]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg text-muted-foreground">Analyzing transit access...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-lg font-semibold text-destructive">{error ?? "No data available."}</p>
        <Button variant="outline" className="mt-4" onClick={() => fetchTransitData()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1140px] space-y-8 px-4 py-8 sm:px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          LEED v5 Access to Transit Calculator
        </h1>
        <p className="mt-2 text-base text-muted-foreground sm:text-lg">
          Type in your project address to view eligible LEED v5 credits and download the
          supporting documentation.
        </p>
      </div>

      <div className="rounded-lg bg-muted px-5 py-3">
        <p className="text-sm font-medium text-foreground">{fullAddress}</p>
      </div>

      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <TransitMap center={data.geocodedLocation} qualifyingStations={data.qualifyingStations} />
      </APIProvider>

      <ResultsPanel data={data} />
      <ScoringBreakdown data={data} />
      <CtaPanel data={data} />
    </div>
  );
}

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
