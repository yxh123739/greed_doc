# Transit Download Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download" button to the transit analysis page that generates a ZIP containing a static map screenshot, MTA schedule PDFs, and a trip summary PDF for LEED submission.

**Architecture:** Single `POST /api/transit/download` endpoint. Server generates all three artifacts in parallel (Static Maps API image, Supabase Storage MTA PDFs, PDFKit trip summary), then streams them as a ZIP via `archiver`. Frontend triggers download from the existing `CtaPanel`.

**Tech Stack:** Next.js API route, Google Maps Static/Directions APIs, Supabase Storage, `pdfkit`, `archiver`

**Spec:** `docs/superpowers/specs/2026-04-02-transit-download-bundle-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/mta-schedules.ts` | CREATE | Route-to-PDF mapping constant, fetch MTA PDFs from Supabase Storage |
| `lib/static-map.ts` | CREATE | Generate Static Maps API URL with markers + polylines, fetch image bytes |
| `lib/trip-summary-pdf.ts` | CREATE | Generate trip summary PDF buffer with PDFKit |
| `app/api/transit/download/route.ts` | CREATE | Download endpoint: orchestrate parallel generation, ZIP stream |
| `app/benchmark/transit/page.tsx` | MODIFY | Wire CtaPanel download button to POST endpoint |
| `tests/mta-schedules.test.ts` | CREATE | Tests for route-to-PDF mapping |
| `tests/trip-summary-pdf.test.ts` | CREATE | Tests for PDF generation |
| `tests/static-map.test.ts` | CREATE | Tests for Static Map URL construction |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdfkit, archiver, and their type definitions**

```bash
pnpm add pdfkit archiver
pnpm add -D @types/pdfkit @types/archiver
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('pdfkit'); require('archiver'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add pdfkit and archiver for transit download bundle"
```

---

### Task 2: MTA schedule mapping and fetching (`lib/mta-schedules.ts`)

**Files:**
- Create: `lib/mta-schedules.ts`
- Create: `tests/mta-schedules.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/mta-schedules.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getScheduleGroups,
  ROUTE_TO_SCHEDULE,
} from "@/lib/mta-schedules";

describe("ROUTE_TO_SCHEDULE", () => {
  it("maps every NYC subway route to a schedule group", () => {
    const allRoutes = [
      "1","2","3","4","5","6","7",
      "A","C","E","B","D","F","M",
      "G","J","Z","L",
      "N","Q","R","W","S","SIR",
    ];
    for (const route of allRoutes) {
      expect(ROUTE_TO_SCHEDULE[route]).toBeDefined();
    }
  });
});

describe("getScheduleGroups", () => {
  it("deduplicates routes that share the same schedule PDF", () => {
    const routeNames = ["1", "2", "3"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toEqual(["1-2-3"]);
  });

  it("returns multiple groups for routes on different PDFs", () => {
    const routeNames = ["1", "A", "L"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toHaveLength(3);
    expect(groups).toContain("1-2-3");
    expect(groups).toContain("A-C-E");
    expect(groups).toContain("L");
  });

  it("skips routes not in the mapping", () => {
    const routeNames = ["1", "UNKNOWN_ROUTE"];
    const groups = getScheduleGroups(routeNames);
    expect(groups).toEqual(["1-2-3"]);
  });

  it("returns empty array for empty input", () => {
    expect(getScheduleGroups([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mta-schedules.test.ts
```

Expected: FAIL — module `@/lib/mta-schedules` not found.

- [ ] **Step 3: Implement `lib/mta-schedules.ts`**

```typescript
import { supabase } from "@/lib/supabase/client";

/**
 * Maps individual MTA subway route names to the PDF schedule group filename.
 * MTA publishes combined schedules per route group.
 */
export const ROUTE_TO_SCHEDULE: Record<string, string> = {
  "1": "1-2-3", "2": "1-2-3", "3": "1-2-3",
  "4": "4-5-6", "5": "4-5-6", "6": "4-5-6",
  "7": "7",
  "A": "A-C-E", "C": "A-C-E", "E": "A-C-E",
  "B": "B-D-F-M", "D": "B-D-F-M", "F": "B-D-F-M", "M": "B-D-F-M",
  "G": "G",
  "J": "J-Z", "Z": "J-Z",
  "L": "L",
  "N": "N-Q-R-W", "Q": "N-Q-R-W", "R": "N-Q-R-W", "W": "N-Q-R-W",
  "S": "S",
  "SIR": "SIR",
};

/**
 * Given a list of route names, return the unique schedule group identifiers.
 * Unknown routes are silently skipped.
 */
export function getScheduleGroups(routeNames: string[]): string[] {
  const groups = new Set<string>();
  for (const name of routeNames) {
    const group = ROUTE_TO_SCHEDULE[name];
    if (group) groups.add(group);
  }
  return Array.from(groups).sort();
}

/**
 * Fetch MTA schedule PDFs from Supabase Storage for the given schedule groups.
 * Returns an array of { filename, buffer } for each successfully fetched PDF.
 * Throws on any fetch failure (fail-fast).
 */
export async function fetchSchedulePdfs(
  groups: string[]
): Promise<{ filename: string; buffer: Buffer }[]> {
  const results = await Promise.all(
    groups.map(async (group) => {
      const filename = `mta-schedule-${group}.pdf`;
      const { data, error } = await supabase.storage
        .from("mta-schedules")
        .download(`${group}.pdf`);

      if (error || !data) {
        throw new Error(
          `Schedule not found: ${filename} is missing from storage`
        );
      }

      const arrayBuffer = await data.arrayBuffer();
      return { filename, buffer: Buffer.from(arrayBuffer) };
    })
  );

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mta-schedules.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mta-schedules.ts tests/mta-schedules.test.ts
git commit -m "feat: add MTA schedule route-to-PDF mapping and fetch logic"
```

---

### Task 3: Static map generator (`lib/static-map.ts`)

**Files:**
- Create: `lib/static-map.ts`
- Create: `tests/static-map.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/static-map.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildStaticMapUrl,
  encodeCirclePolyline,
} from "@/lib/static-map";

describe("encodeCirclePolyline", () => {
  it("returns a non-empty encoded string", () => {
    const encoded = encodeCirclePolyline(
      { lat: 40.7649, lng: -73.9794 },
      804.672, // 0.5 mi in meters
      64
    );
    expect(encoded.length).toBeGreaterThan(10);
  });
});

describe("buildStaticMapUrl", () => {
  const projectLocation = { lat: 40.7649, lng: -73.9794 };
  const stations = [
    {
      name: "57 St",
      location: { lat: 40.7641, lng: -73.9773 },
      index: 1,
    },
    {
      name: "59 St",
      location: { lat: 40.7681, lng: -73.9819 },
      index: 2,
    },
  ];

  it("includes the API key", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("key=TEST_KEY");
  });

  it("includes project location marker", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("markers=");
    expect(url).toContain("40.7649");
  });

  it("includes station markers with labels", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("label%3A1");
    expect(url).toContain("label%3A2");
  });

  it("includes the circle path", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("path=");
    expect(url).toContain("enc%3A");
  });

  it("uses 640x400 size with scale 2", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("size=640x400");
    expect(url).toContain("scale=2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/static-map.test.ts
```

Expected: FAIL — module `@/lib/static-map` not found.

- [ ] **Step 3: Implement `lib/static-map.ts`**

```typescript
const STATIC_MAP_BASE = "https://maps.googleapis.com/maps/api/staticmap";
const MAP_SIZE = "640x400";
const MAP_SCALE = "2";

interface StationPin {
  name: string;
  location: { lat: number; lng: number };
  index: number;
}

/**
 * Encode a circle as a polyline for Google Static Maps.
 * Uses the Google encoded polyline algorithm.
 */
export function encodeCirclePolyline(
  center: { lat: number; lng: number },
  radiusMeters: number,
  numPoints: number = 64
): string {
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;
    const dLat = (radiusMeters / 111_320) * Math.cos(angle);
    const dLng =
      (radiusMeters /
        (111_320 * Math.cos((center.lat * Math.PI) / 180))) *
      Math.sin(angle);
    points.push({ lat: center.lat + dLat, lng: center.lng + dLng });
  }
  return encodePolyline(points);
}

function encodePolyline(points: { lat: number; lng: number }[]): string {
  let encoded = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encoded += encodeSignedNumber(lat - prevLat);
    encoded += encodeSignedNumber(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return encoded;
}

function encodeSignedNumber(num: number): string {
  let sgn = num << 1;
  if (num < 0) sgn = ~sgn;
  let encoded = "";
  while (sgn >= 0x20) {
    encoded += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  encoded += String.fromCharCode(sgn + 63);
  return encoded;
}

/**
 * Build a Google Static Maps URL with:
 * - Blue pin for project location
 * - Purple pins with numeric labels for qualifying stations
 * - Dashed green circle for 0.5 mi radius
 */
export function buildStaticMapUrl(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string
): string {
  const params = new URLSearchParams();
  params.set("size", MAP_SIZE);
  params.set("scale", MAP_SCALE);
  params.set("maptype", "roadmap");
  params.set("key", apiKey);

  // Project location marker (blue)
  params.append(
    "markers",
    `color:blue|label:P|${projectLocation.lat},${projectLocation.lng}`
  );

  // Station markers (purple with numeric labels)
  for (const station of stations) {
    params.append(
      "markers",
      `color:purple|label:${station.index}|${station.location.lat},${station.location.lng}`
    );
  }

  // 0.5 mi circle
  const circleEncoded = encodeCirclePolyline(projectLocation, 804.672);
  params.append(
    "path",
    `color:0x7cb342aa|weight:2|fillcolor:0x7cb3420a|enc:${circleEncoded}`
  );

  return `${STATIC_MAP_BASE}?${params.toString()}`;
}

/**
 * Fetch the static map image as a Buffer.
 * Throws with descriptive message on failure.
 */
export async function fetchStaticMapImage(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string
): Promise<Buffer> {
  const url = buildStaticMapUrl(projectLocation, stations, apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Map generation failed: Static Maps API returned ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/static-map.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/static-map.ts tests/static-map.test.ts
git commit -m "feat: add static map URL builder with circle polyline encoding"
```

---

### Task 4: Trip summary PDF generator (`lib/trip-summary-pdf.ts`)

**Files:**
- Create: `lib/trip-summary-pdf.ts`
- Create: `tests/trip-summary-pdf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/trip-summary-pdf.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateTripSummaryPdf } from "@/lib/trip-summary-pdf";
import type { TransitStation } from "@/lib/transit-types";

function makeStation(overrides: Partial<TransitStation> = {}): TransitStation {
  return {
    stopId: "101",
    name: "57 St - 7 Av",
    location: { lat: 40.7641, lng: -73.9773 },
    walkingDistanceMi: 0.15,
    stationType: "subway",
    routes: [
      {
        routeId: "N",
        routeName: "N",
        routeType: 1,
        weekdayTrips: 120,
        weekendTrips: 85,
        counted: true,
      },
    ],
    ...overrides,
  };
}

describe("generateTripSummaryPdf", () => {
  it("returns a Buffer containing a valid PDF", async () => {
    const buffer = await generateTripSummaryPdf({
      address: "7th Ave & Central Park S, New York, NY 10019",
      qualifyingStations: [makeStation()],
      totalWeekdayTrips: 120,
      totalWeekendTrips: 85,
      transitScore: 1,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    // PDF magic bytes
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles multiple stations", async () => {
    const stations = [
      makeStation({ stopId: "101", name: "57 St" }),
      makeStation({
        stopId: "201",
        name: "59 St - Columbus",
        walkingDistanceMi: 0.32,
        routes: [
          {
            routeId: "A",
            routeName: "A",
            routeType: 1,
            weekdayTrips: 78,
            weekendTrips: 52,
            counted: true,
          },
        ],
      }),
    ];

    const buffer = await generateTripSummaryPdf({
      address: "7th Ave & Central Park S, New York, NY 10019",
      qualifyingStations: stations,
      totalWeekdayTrips: 198,
      totalWeekendTrips: 137,
      transitScore: 2,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles zero qualifying stations", async () => {
    const buffer = await generateTripSummaryPdf({
      address: "Remote Location, NY",
      qualifyingStations: [],
      totalWeekdayTrips: 0,
      totalWeekendTrips: 0,
      transitScore: 0,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/trip-summary-pdf.test.ts
```

Expected: FAIL — module `@/lib/trip-summary-pdf` not found.

- [ ] **Step 3: Implement `lib/trip-summary-pdf.ts`**

```typescript
import PDFDocument from "pdfkit";
import type { TransitStation } from "@/lib/transit-types";
import { TRANSIT_THRESHOLDS } from "@/lib/transit-types";

interface TripSummaryInput {
  address: string;
  qualifyingStations: TransitStation[];
  totalWeekdayTrips: number;
  totalWeekendTrips: number;
  transitScore: number;
}

const GREEN = "#1a5632";
const LIGHT_BG = "#f5f7f5";
const ROW_ALT = "#fafafa";
const BORDER = "#e0e0e0";

/**
 * Generate a LEED-format trip summary PDF as a Buffer.
 */
export async function generateTripSummaryPdf(
  input: TripSummaryInput
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, input);
    drawProjectInfo(doc, input);
    drawRoutesTable(doc, input);
    drawScoreBox(doc, input);
    drawFooter(doc);

    doc.end();
  });
}

function drawHeader(doc: PDFKit.PDFDocument, _input: TripSummaryInput): void {
  doc
    .fontSize(18)
    .fillColor(GREEN)
    .text("LEED v5 BD+C — LTc3 Access to Transit", { align: "left" });
  doc
    .fontSize(11)
    .fillColor("#666")
    .text("Quality Transit Calculation — Option 2: Subway", {
      align: "left",
    });
  doc.moveDown(0.5);
  doc
    .strokeColor(GREEN)
    .lineWidth(2)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown(1);
}

function drawProjectInfo(
  doc: PDFKit.PDFDocument,
  input: TripSummaryInput
): void {
  const startY = doc.y;
  const boxHeight = 52;

  doc
    .rect(50, startY, 512, boxHeight)
    .fillAndStroke(LIGHT_BG, LIGHT_BG);

  doc.fillColor("#666").fontSize(9);
  doc.text("Project Address:", 62, startY + 8, { continued: false });
  doc.fillColor("#1a1a1a").fontSize(9);
  doc.text(input.address, 160, startY + 8);

  doc.fillColor("#666");
  doc.text("Analysis Date:", 62, startY + 22);
  doc.fillColor("#1a1a1a");
  doc.text(new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }), 160, startY + 22);

  doc.fillColor("#666");
  doc.text("Walking Radius:", 62, startY + 36);
  doc.fillColor("#1a1a1a");
  doc.text("0.5 miles (Subway / Heavy Rail)", 160, startY + 36);

  doc.y = startY + boxHeight + 16;
}

function drawRoutesTable(
  doc: PDFKit.PDFDocument,
  input: TripSummaryInput
): void {
  doc.fontSize(12).fillColor(GREEN).text("Qualifying Transit Routes");
  doc.moveDown(0.5);

  const colX = [50, 70, 200, 290, 350, 430, 500];
  const colW = [20, 130, 90, 60, 80, 70, 62];
  const headers = [
    "#",
    "Station",
    "Route",
    "Type",
    "Walk Dist.",
    "Wkday Trips",
    "Wkend Trips",
  ];

  // Header row
  const headerY = doc.y;
  doc.rect(50, headerY, 512, 18).fill(GREEN);
  doc.fillColor("#fff").fontSize(8);
  headers.forEach((h, i) => {
    const align = i >= 4 ? "right" : "left";
    doc.text(h, colX[i], headerY + 4, {
      width: colW[i],
      align,
    });
  });
  doc.y = headerY + 18;

  // Data rows
  let rowIndex = 0;
  for (const station of input.qualifyingStations) {
    const countedRoutes = station.routes.filter((r) => r.counted);
    for (const route of countedRoutes) {
      rowIndex++;
      const rowY = doc.y;

      if (rowIndex % 2 === 0) {
        doc.rect(50, rowY, 512, 16).fill(ROW_ALT);
      }

      doc.fillColor("#1a1a1a").fontSize(8);
      doc.text(String(rowIndex), colX[0], rowY + 4, { width: colW[0] });
      doc.text(station.name, colX[1], rowY + 4, { width: colW[1] });
      doc.text(route.routeName, colX[2], rowY + 4, { width: colW[2] });
      doc.text("Subway", colX[3], rowY + 4, { width: colW[3] });
      doc.text(`${station.walkingDistanceMi.toFixed(2)} mi`, colX[4], rowY + 4, {
        width: colW[4],
        align: "right",
      });
      doc.text(String(route.weekdayTrips), colX[5], rowY + 4, {
        width: colW[5],
        align: "right",
      });
      doc.text(String(route.weekendTrips), colX[6], rowY + 4, {
        width: colW[6],
        align: "right",
      });

      doc.y = rowY + 16;
    }
  }

  // Separator line
  doc
    .strokeColor(GREEN)
    .lineWidth(1.5)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();

  // Total row
  const totalY = doc.y + 2;
  doc.fontSize(9).fillColor("#1a1a1a");
  doc.font("Helvetica-Bold");
  doc.text("TOTAL", colX[0], totalY + 4, { width: 380 });
  doc.text(String(input.totalWeekdayTrips), colX[5], totalY + 4, {
    width: colW[5],
    align: "right",
  });
  doc.text(String(input.totalWeekendTrips), colX[6], totalY + 4, {
    width: colW[6],
    align: "right",
  });
  doc.font("Helvetica");
  doc.y = totalY + 20;
}

function drawScoreBox(
  doc: PDFKit.PDFDocument,
  input: TripSummaryInput
): void {
  doc.moveDown(0.5);
  const boxY = doc.y;
  const boxH = 50;

  doc
    .rect(50, boxY, 512, boxH)
    .strokeColor(GREEN)
    .lineWidth(1.5)
    .stroke();

  // Score (left side)
  doc.fillColor("#666").fontSize(8);
  doc.text("LEED SCORE", 62, boxY + 6);
  doc.fillColor(GREEN).fontSize(22).font("Helvetica-Bold");
  doc.text(`${input.transitScore} / 4 Points`, 62, boxY + 18);
  doc.font("Helvetica");

  // Threshold (right side)
  const threshold = TRANSIT_THRESHOLDS.find(
    (t) => t.points === input.transitScore
  );
  if (threshold) {
    doc.fillColor("#666").fontSize(8);
    doc.text(
      `Threshold Met: ≥ ${threshold.weekday} weekday, ≥ ${threshold.weekend} weekend`,
      300,
      boxY + 12,
      { width: 250, align: "right" }
    );
  }
  doc.fillColor("#666").fontSize(8);
  doc.text("Credit: LTc3 Access to Transit, Option 2", 300, boxY + 28, {
    width: 250,
    align: "right",
  });

  doc.y = boxY + boxH + 10;
}

function drawFooter(doc: PDFKit.PDFDocument): void {
  doc.moveDown(1);
  doc
    .strokeColor("#ddd")
    .lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(562, doc.y)
    .stroke();
  doc.moveDown(0.3);
  doc.fillColor("#999").fontSize(7);
  doc.text(
    "Generated by Anchor Sustainability LEED Feasibility Tool",
    50,
    doc.y,
    { width: 256 }
  );
  doc.text("Source: MTA GTFS Static Feed", 306, doc.y, {
    width: 256,
    align: "right",
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/trip-summary-pdf.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trip-summary-pdf.ts tests/trip-summary-pdf.test.ts
git commit -m "feat: add PDFKit trip summary generator for LEED transit report"
```

---

### Task 5: Download API endpoint (`app/api/transit/download/route.ts`)

**Files:**
- Create: `app/api/transit/download/route.ts`

- [ ] **Step 1: Implement the download endpoint**

Create `app/api/transit/download/route.ts`:

```typescript
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

    return new NextResponse(zipBuffer, {
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
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/transit/download/route.ts
git commit -m "feat: add /api/transit/download endpoint for LEED report ZIP"
```

---

### Task 6: Wire up frontend download button

**Files:**
- Modify: `app/benchmark/transit/page.tsx`

- [ ] **Step 1: Update `CtaPanel` to accept data and trigger download**

In `app/benchmark/transit/page.tsx`, replace the existing `CtaPanel` function (lines 397-409):

```typescript
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
```

- [ ] **Step 2: Pass `data` prop to `CtaPanel` in `TransitPageContent`**

In the same file, find the `<CtaPanel />` usage (line 509) and change it to:

```typescript
<CtaPanel data={data} />
```

- [ ] **Step 3: Add `toast` import if not already present**

Check if `sonner` is already imported. The current file does NOT import `toast` from `sonner`, but `sonner` is already a project dependency. The dynamic `import("sonner")` in the error handler avoids adding it to the component's static imports. No change needed here.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/benchmark/transit/page.tsx
git commit -m "feat: wire download button to transit report ZIP endpoint"
```

---

### Task 7: Upload MTA schedule PDFs to Supabase Storage

**Files:**
- No code files — manual Supabase setup

- [ ] **Step 1: Create the `mta-schedules` bucket in Supabase**

Go to Supabase Dashboard → Storage → Create bucket named `mta-schedules`, set it to **private** (server-side access only via service role key or anon key with RLS).

Alternatively via SQL:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('mta-schedules', 'mta-schedules', false);
```

- [ ] **Step 2: Download MTA Printable Subway Schedules**

Go to https://www.mta.info/schedules and download each printable subway schedule PDF. Save them locally with these filenames:

```
1-2-3.pdf
4-5-6.pdf
7.pdf
A-C-E.pdf
B-D-F-M.pdf
G.pdf
J-Z.pdf
L.pdf
N-Q-R-W.pdf
S.pdf
SIR.pdf
```

- [ ] **Step 3: Upload PDFs to Supabase Storage**

Upload all PDF files to the `mta-schedules` bucket. This can be done via the Supabase Dashboard (Storage → mta-schedules → Upload files) or via script:

```bash
for f in 1-2-3.pdf 4-5-6.pdf 7.pdf A-C-E.pdf B-D-F-M.pdf G.pdf J-Z.pdf L.pdf N-Q-R-W.pdf S.pdf SIR.pdf; do
  echo "Uploading $f..."
  # Use Supabase CLI or Dashboard
done
```

- [ ] **Step 4: Verify uploads**

Confirm all 11 files are visible in the Supabase Storage dashboard under `mta-schedules`.

---

### Task 8: End-to-end manual test

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Navigate to transit analysis page**

Open the app, go to Benchmark → enter an NYC address (e.g., "7th Ave & Central Park S, New York, NY 10019") → navigate to the transit results page.

- [ ] **Step 3: Click Download and verify ZIP contents**

Click the "Download" button. Verify:

1. Loading state appears ("Generating report...")
2. ZIP file downloads as `LEED-Transit-Report.zip`
3. Unzip and verify all three types of files are present:
   - `transit-map.png` — visible map with blue project pin and purple station pins
   - `trip-summary.pdf` — opens as a valid PDF, contains the routes table with correct trip counts
   - `mta-schedule-*.pdf` — one or more MTA schedule PDFs matching the qualifying routes

- [ ] **Step 4: Test error scenarios**

1. Temporarily remove an MTA PDF from Supabase Storage → click Download → verify toast shows specific error message about the missing schedule
2. Use an address with no qualifying stations → verify the button still works (empty report or appropriate handling)

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit any final adjustments**

```bash
git add -A
git commit -m "test: verify transit download bundle end-to-end"
```
