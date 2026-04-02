import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { fetchStaticMapImage } from "@/lib/static-map";
import { getScheduleGroups, fetchSchedulePdfs } from "@/lib/mta-schedules";
import { generateTripSummaryPdf } from "@/lib/trip-summary-pdf";
import type { TransitStation } from "@/lib/transit-types";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

interface DownloadRequest {
  address: string;
  city: string;
  stateProvince: string;
  zipCode: string;
  country: string;
  geocodedLocation: { lat: number; lng: number };
  qualifyingStations: TransitStation[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key is not configured." },
      { status: 500 }
    );
  }

  let payload: DownloadRequest;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const {
    address,
    city,
    stateProvince,
    zipCode,
    country,
    geocodedLocation,
    qualifyingStations,
    totalWeekdayTrips,
    totalWeekendTrips,
    transitScore,
  } = payload;

  if (!geocodedLocation || !qualifyingStations) {
    return NextResponse.json(
      { error: "Missing required fields: geocodedLocation, qualifyingStations." },
      { status: 400 }
    );
  }

  const fullAddress = [address, city, stateProvince, zipCode, country]
    .filter(Boolean)
    .join(", ");

  // Collect all counted route names for MTA schedule matching
  const countedRouteNames = Array.from(
    new Set(
      qualifyingStations.flatMap((s) =>
        s.routes.filter((r) => r.counted).map((r) => r.routeName)
      )
    )
  );
  const scheduleGroups = getScheduleGroups(countedRouteNames);

  // Station pins for the static map
  const stationPins = qualifyingStations.map((s, i) => ({
    name: s.name,
    location: s.location,
    index: i + 1,
  }));

  // Generate all artifacts in parallel — fail-fast on any error
  let mapImage: Buffer;
  let schedulePdfs: { filename: string; buffer: Buffer }[];
  let summaryPdf: Buffer;

  try {
    [mapImage, schedulePdfs, summaryPdf] = await Promise.all([
      fetchStaticMapImage(geocodedLocation, stationPins, API_KEY),
      fetchSchedulePdfs(scheduleGroups),
      generateTripSummaryPdf({
        address: fullAddress,
        qualifyingStations,
        totalWeekdayTrips,
        totalWeekendTrips,
        transitScore,
      }),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generation error";
    console.error("Download bundle generation failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Package into ZIP and stream
  try {
    const archive = archiver("zip", { zlib: { level: 5 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));

    const finalized = new Promise<Buffer>((resolve, reject) => {
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
    });

    archive.append(mapImage, { name: "LEED-Transit-Report/transit-map.png" });
    archive.append(summaryPdf, {
      name: "LEED-Transit-Report/trip-summary.pdf",
    });
    for (const pdf of schedulePdfs) {
      archive.append(pdf.buffer, {
        name: `LEED-Transit-Report/${pdf.filename}`,
      });
    }
    archive.finalize();

    const zipBuffer = await finalized;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="LEED-Transit-Report.zip"',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ZIP packaging failed";
    console.error("ZIP packaging failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
