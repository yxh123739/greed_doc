# LTc3 Benchmark Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a first-version LTc3 benchmark workspace that automatically evaluates Walkable Location, Access to Transit, and review-assisted Surrounding Density for U.S. projects, shows the 400m/800m Google Map analysis on the page, and exports a LEED-style evidence bundle.

**Architecture:** Keep all LEED logic in a new `lib/benchmark` domain layer and make the UI a thin client over typed API routes. Use Google Maps for geocoding, map rendering, place search, walking routes, and static map evidence; use Transitland for scheduled departures; use Overpass only to seed surrounding-density geometry because Google does not expose LEED-ready building footprints or dwelling units. Every option result must carry both `score` and `reviewStatus` so the UI can distinguish auto-qualified results from items that still need manual review.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Google Maps JavaScript API, Places API, Routes API, Maps Static API, Transitland REST API, Overpass API, JSZip, Vitest, React Testing Library, MSW

---

### Task 1: Add Benchmark Test Harness And Environment Contract

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/mocks/server.ts`
- Create: `lib/benchmark/config.ts`
- Test: `lib/benchmark/__tests__/config.test.ts`

**Step 1: Write the failing test**

Add Vitest scripts and a first failing config test.

```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/google.maps": "^3.58.1",
    "@vitest/coverage-v8": "^3.2.4",
    "jsdom": "^26.1.0",
    "msw": "^2.11.2",
    "vitest": "^3.2.4"
  }
}
```

```ts
// lib/benchmark/__tests__/config.test.ts
import { describe, expect, it } from "vitest";
import { getBenchmarkEnv } from "@/lib/benchmark/config";

describe("getBenchmarkEnv", () => {
  it("throws when Google server keys are missing", () => {
    expect(() => getBenchmarkEnv({})).toThrow("GOOGLE_MAPS_API_KEY");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/benchmark/__tests__/config.test.ts`

Expected: FAIL with `Cannot find module '@/lib/benchmark/config'` or equivalent import error.

**Step 3: Write minimal implementation**

```ts
// lib/benchmark/config.ts
type EnvSource = Record<string, string | undefined>;

export function getBenchmarkEnv(source: EnvSource = process.env) {
  const googleServerKey = source.GOOGLE_MAPS_API_KEY;
  const googleClientKey = source.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const transitlandApiKey = source.TRANSITLAND_API_KEY;

  if (!googleServerKey) throw new Error("Missing GOOGLE_MAPS_API_KEY");
  if (!googleClientKey) throw new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  if (!transitlandApiKey) throw new Error("Missing TRANSITLAND_API_KEY");

  return { googleServerKey, googleClientKey, transitlandApiKey };
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/benchmark/__tests__/config.test.ts`

Expected: PASS with `1 passed`.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/setup.ts tests/mocks/server.ts lib/benchmark/config.ts lib/benchmark/__tests__/config.test.ts
git commit -m "test: add benchmark unit test harness"
```

### Task 2: Build LTc3 Scoring Constants, Types, And Pure Functions

**Files:**
- Create: `lib/benchmark/ltc3/constants.ts`
- Create: `lib/benchmark/ltc3/types.ts`
- Create: `lib/benchmark/ltc3/place-categories.ts`
- Create: `lib/benchmark/ltc3/scoring.ts`
- Test: `lib/benchmark/ltc3/__tests__/scoring.test.ts`

**Step 1: Write the failing test**

```ts
// lib/benchmark/ltc3/__tests__/scoring.test.ts
import { describe, expect, it } from "vitest";
import {
  scoreWalkScore,
  scoreTransitTrips,
  scoreDensity,
  pickQualifiedUses,
} from "@/lib/benchmark/ltc3/scoring";

describe("LTc3 scoring", () => {
  it("maps walk score ranges to LEED points", () => {
    expect(scoreWalkScore(61)).toBe(1);
    expect(scoreWalkScore(74)).toBe(2);
    expect(scoreWalkScore(88)).toBe(3);
  });

  it("scores transit only when weekday and weekend minimums are both met", () => {
    expect(scoreTransitTrips({ weekday: 132, weekend: 78 })).toBe(2);
    expect(scoreTransitTrips({ weekday: 132, weekend: 30 })).toBe(1);
  });

  it("supports separate and combined density thresholds", () => {
    expect(scoreDensity({ residentialDuPerAcre: 12, nonResidentialFar: 0.8 })).toBe(2);
    expect(scoreDensity({ combinedSqFtPerAcre: 22000 })).toBe(1);
  });

  it("deduplicates uses, caps each use type at two, and requires three categories", () => {
    const result = pickQualifiedUses([
      { placeId: "1", useType: "restaurant", category: "community-serving retail" },
      { placeId: "2", useType: "restaurant", category: "community-serving retail" },
      { placeId: "3", useType: "restaurant", category: "community-serving retail" },
      { placeId: "4", useType: "grocery_with_produce", category: "food retail" },
      { placeId: "5", useType: "bank", category: "services" },
      { placeId: "6", useType: "park", category: "community resources" },
    ]);

    expect(result.counted.length).toBe(5);
    expect(result.categoriesCovered).toBe(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/benchmark/ltc3/__tests__/scoring.test.ts`

Expected: FAIL with missing exports from `@/lib/benchmark/ltc3/scoring`.

**Step 3: Write minimal implementation**

```ts
// lib/benchmark/ltc3/constants.ts
export const WALK_SCORE_THRESHOLDS = [
  { min: 80, points: 3 },
  { min: 70, points: 2 },
  { min: 60, points: 1 },
];

export const TRANSIT_THRESHOLDS = [
  { weekday: 360, weekend: 216, points: 4 },
  { weekday: 160, weekend: 120, points: 3 },
  { weekday: 132, weekend: 78, points: 2 },
  { weekday: 72, weekend: 30, points: 1 },
];

export const DENSITY_THRESHOLDS = {
  combined: [
    { minSqFtPerAcre: 35000, points: 2 },
    { minSqFtPerAcre: 22000, points: 1 },
  ],
  separate: [
    { minResidentialDuPerAcre: 12, minNonResidentialFar: 0.8, points: 2 },
    { minResidentialDuPerAcre: 7, minNonResidentialFar: 0.5, points: 1 },
  ],
};
```

```ts
// lib/benchmark/ltc3/scoring.ts
import {
  DENSITY_THRESHOLDS,
  TRANSIT_THRESHOLDS,
  WALK_SCORE_THRESHOLDS,
} from "@/lib/benchmark/ltc3/constants";

export function scoreWalkScore(score: number | null) {
  if (score === null) return 0;
  return WALK_SCORE_THRESHOLDS.find((rule) => score >= rule.min)?.points ?? 0;
}

export function scoreTransitTrips(input: { weekday: number; weekend: number }) {
  return (
    TRANSIT_THRESHOLDS.find(
      (rule) => input.weekday >= rule.weekday && input.weekend >= rule.weekend
    )?.points ?? 0
  );
}

export function scoreDensity(input: {
  combinedSqFtPerAcre?: number;
  residentialDuPerAcre?: number;
  nonResidentialFar?: number;
}) {
  const separate = DENSITY_THRESHOLDS.separate.find(
    (rule) =>
      (input.residentialDuPerAcre ?? 0) >= rule.minResidentialDuPerAcre &&
      (input.nonResidentialFar ?? 0) >= rule.minNonResidentialFar
  );

  if (separate) return separate.points;

  return (
    DENSITY_THRESHOLDS.combined.find(
      (rule) => (input.combinedSqFtPerAcre ?? 0) >= rule.minSqFtPerAcre
    )?.points ?? 0
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/benchmark/ltc3/__tests__/scoring.test.ts`

Expected: PASS with `4 passed`.

**Step 5: Commit**

```bash
git add lib/benchmark/ltc3/constants.ts lib/benchmark/ltc3/types.ts lib/benchmark/ltc3/place-categories.ts lib/benchmark/ltc3/scoring.ts lib/benchmark/ltc3/__tests__/scoring.test.ts
git commit -m "feat: add LTc3 scoring engine"
```

### Task 3: Add External Data Clients For Google Maps, Transitland, And Overpass

**Files:**
- Create: `lib/benchmark/http.ts`
- Create: `lib/benchmark/google-maps/types.ts`
- Create: `lib/benchmark/google-maps/client.ts`
- Create: `lib/benchmark/google-maps/static-maps.ts`
- Create: `lib/benchmark/transitland/client.ts`
- Create: `lib/benchmark/overpass/client.ts`
- Test: `lib/benchmark/__tests__/clients.test.ts`

**Step 1: Write the failing test**

```ts
// lib/benchmark/__tests__/clients.test.ts
import { describe, expect, it, vi } from "vitest";
import { createGoogleMapsClient } from "@/lib/benchmark/google-maps/client";
import { createTransitlandClient } from "@/lib/benchmark/transitland/client";
import { createOverpassClient } from "@/lib/benchmark/overpass/client";

describe("benchmark data clients", () => {
  it("normalizes Google geocoding and route results", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ place_id: "abc", geometry: { location: { lat: 40.0, lng: -73.0 } }, formatted_address: "1 Main St" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ routes: [{ distanceMeters: 612, duration: "480s", polyline: { encodedPolyline: "abcd" } }] })));

    const client = createGoogleMapsClient({ apiKey: "test", fetcher });
    const geocode = await client.geocode("1 Main St, New York, NY");
    const route = await client.computeWalkingRoute({
      originPlaceId: "project",
      destinationPlaceId: "abc",
    });

    expect(geocode.placeId).toBe("abc");
    expect(route.distanceMeters).toBe(612);
  });

  it("aggregates Transitland departures into LEED weekday and weekend totals", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ departures: [{ trip: { route_id: "M1", direction_id: 0 } }] }))
    );

    const client = createTransitlandClient({ apiKey: "test", fetcher });
    const result = await client.getRouteTripTotals({ stopKey: "s-demo" });

    expect(result.routes[0]?.routeId).toBe("M1");
  });

  it("parses Overpass building and land-use features", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elements: [{ type: "way", id: 1, tags: { building: "apartments", "building:levels": "7" }, geometry: [{ lat: 40, lon: -73 }, { lat: 40.001, lon: -73 }] }] }))
    );

    const client = createOverpassClient({ fetcher });
    const result = await client.fetchDensityFeatures({ lat: 40, lng: -73, radiusMeters: 400 });

    expect(result.features.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/benchmark/__tests__/clients.test.ts`

Expected: FAIL with missing client factory modules.

**Step 3: Write minimal implementation**

```ts
// lib/benchmark/google-maps/client.ts
export function createGoogleMapsClient({
  apiKey,
  fetcher = fetch,
}: {
  apiKey: string;
  fetcher?: typeof fetch;
}) {
  return {
    async geocode(address: string) {
      const response = await fetcher(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
      );
      const payload = await response.json();
      const first = payload.results[0];
      return {
        placeId: first.place_id,
        formattedAddress: first.formatted_address,
        location: first.geometry.location,
      };
    },
    async computeWalkingRoute(input: {
      originPlaceId: string;
      destinationPlaceId: string;
    }) {
      const response = await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      return payload.routes[0];
    },
  };
}
```

```ts
// lib/benchmark/transitland/client.ts
export function createTransitlandClient({
  apiKey,
  fetcher = fetch,
}: {
  apiKey: string;
  fetcher?: typeof fetch;
}) {
  return {
    async getRouteTripTotals({ stopKey }: { stopKey: string }) {
      const response = await fetcher(
        `https://transit.land/api/v2/rest/stops/${stopKey}/departures?api_key=${apiKey}`
      );
      const payload = await response.json();
      return {
        routes: payload.departures.map((departure: any) => ({
          routeId: departure.trip.route_id,
          directionId: departure.trip.direction_id,
        })),
      };
    },
  };
}
```

```ts
// lib/benchmark/overpass/client.ts
export function createOverpassClient({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  return {
    async fetchDensityFeatures(input: { lat: number; lng: number; radiusMeters: number }) {
      const query = `[out:json];way(around:${input.radiusMeters},${input.lat},${input.lng})["building"];out geom;`;
      const response = await fetcher("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
      });
      const payload = await response.json();
      return {
        features: payload.elements,
      };
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/benchmark/__tests__/clients.test.ts`

Expected: PASS with `3 passed`.

**Step 5: Commit**

```bash
git add lib/benchmark/http.ts lib/benchmark/google-maps/types.ts lib/benchmark/google-maps/client.ts lib/benchmark/google-maps/static-maps.ts lib/benchmark/transitland/client.ts lib/benchmark/overpass/client.ts lib/benchmark/__tests__/clients.test.ts
git commit -m "feat: add benchmark data source clients"
```

### Task 4: Orchestrate LTc3 Assessment And Evidence Bundle Generation

**Files:**
- Modify: `package.json`
- Create: `lib/benchmark/ltc3/assessment.ts`
- Create: `lib/benchmark/ltc3/evidence.ts`
- Create: `lib/benchmark/ltc3/manual-review.ts`
- Create: `app/api/benchmark/assess/route.ts`
- Create: `app/api/benchmark/evidence/route.ts`
- Test: `lib/benchmark/ltc3/__tests__/assessment.test.ts`
- Test: `app/api/benchmark/__tests__/evidence-route.test.ts`

**Step 1: Write the failing test**

```ts
// lib/benchmark/ltc3/__tests__/assessment.test.ts
import { describe, expect, it } from "vitest";
import { assessLtc3 } from "@/lib/benchmark/ltc3/assessment";

describe("assessLtc3", () => {
  it("returns per-option points, total points, and review flags", async () => {
    const result = await assessLtc3({
      project: {
        address: "170 W 96th St, New York, NY 10025",
        country: "United States",
      },
      walkScore: 61,
      transit: { weekday: 132, weekend: 78 },
      density: { residentialDuPerAcre: 12, nonResidentialFar: 0.8 },
      qualifiedUses: [
        { placeId: "1", useType: "grocery_with_produce", category: "food retail" },
        { placeId: "2", useType: "bank", category: "services" },
        { placeId: "3", useType: "park", category: "community resources" },
        { placeId: "4", useType: "restaurant", category: "community-serving retail" },
      ],
    });

    expect(result.option1.points).toBe(2);
    expect(result.option2.points).toBe(2);
    expect(result.option3.points).toBe(1);
    expect(result.totalPoints).toBe(5);
  });
});
```

```ts
// app/api/benchmark/__tests__/evidence-route.test.ts
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/benchmark/evidence/route";

describe("POST /api/benchmark/evidence", () => {
  it("returns a zip payload", async () => {
    const response = await POST(new Request("http://localhost/api/benchmark/evidence", {
      method: "POST",
      body: JSON.stringify({ assessmentId: "demo" }),
    }));

    expect(response.headers.get("content-type")).toContain("application/zip");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/benchmark/ltc3/__tests__/assessment.test.ts app/api/benchmark/__tests__/evidence-route.test.ts`

Expected: FAIL because assessment and API routes do not exist.

**Step 3: Write minimal implementation**

Add a direct runtime dependency for zip generation.

```json
{
  "dependencies": {
    "jszip": "^3.10.1"
  }
}
```

```ts
// lib/benchmark/ltc3/assessment.ts
import { pickQualifiedUses, scoreDensity, scoreTransitTrips, scoreWalkScore } from "@/lib/benchmark/ltc3/scoring";

export async function assessLtc3(input: any) {
  const walkable = pickQualifiedUses(input.qualifiedUses ?? []);

  return {
    option1: { points: scoreDensity(input.density), reviewStatus: "needs-review" },
    option2: { points: scoreTransitTrips(input.transit), reviewStatus: "auto-qualified" },
    option3: {
      points: input.walkScore ? scoreWalkScore(input.walkScore) : walkable.points,
      reviewStatus: input.walkScore ? "auto-qualified" : "needs-review",
    },
    totalPoints:
      scoreDensity(input.density) +
      scoreTransitTrips(input.transit) +
      (input.walkScore ? scoreWalkScore(input.walkScore) : walkable.points),
  };
}
```

```ts
// app/api/benchmark/evidence/route.ts
import JSZip from "jszip";
import { NextResponse } from "next/server";

export async function POST() {
  const zip = new JSZip();
  zip.file("assessment-summary.json", JSON.stringify({ ok: true }, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="ltc3-evidence.zip"',
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit lib/benchmark/ltc3/__tests__/assessment.test.ts app/api/benchmark/__tests__/evidence-route.test.ts`

Expected: PASS with both suites green.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml lib/benchmark/ltc3/assessment.ts lib/benchmark/ltc3/evidence.ts lib/benchmark/ltc3/manual-review.ts app/api/benchmark/assess/route.ts app/api/benchmark/evidence/route.ts lib/benchmark/ltc3/__tests__/assessment.test.ts app/api/benchmark/__tests__/evidence-route.test.ts
git commit -m "feat: add LTc3 assessment and evidence routes"
```

### Task 5: Replace The Benchmark Page With A Real LTc3 Workspace

**Files:**
- Modify: `app/benchmark/page.tsx`
- Create: `components/benchmark/benchmark-workspace.tsx`
- Create: `components/benchmark/benchmark-form.tsx`
- Create: `components/benchmark/option-score-card.tsx`
- Create: `components/benchmark/assessment-summary.tsx`
- Test: `components/benchmark/__tests__/benchmark-workspace.test.tsx`

**Step 1: Write the failing test**

```tsx
// components/benchmark/__tests__/benchmark-workspace.test.tsx
import { render, screen } from "@testing-library/react";
import { BenchmarkWorkspace } from "@/components/benchmark/benchmark-workspace";

describe("BenchmarkWorkspace", () => {
  it("renders LTc3 option cards and a map analysis legend", () => {
    render(<BenchmarkWorkspace />);

    expect(screen.getByText("LTc3 Compact and Connected Development")).toBeInTheDocument();
    expect(screen.getByText("400m analysis")).toBeInTheDocument();
    expect(screen.getByText("800m analysis")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit components/benchmark/__tests__/benchmark-workspace.test.tsx`

Expected: FAIL with missing component import.

**Step 3: Write minimal implementation**

```tsx
// components/benchmark/benchmark-workspace.tsx
export function BenchmarkWorkspace() {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">LTc3 Compact and Connected Development</h2>
        <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
          <span>400m analysis</span>
          <span>800m analysis</span>
        </div>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border p-4">Option 1. Surrounding Density</div>
        <div className="rounded-xl border p-4">Option 2. Access to Transit</div>
        <div className="rounded-xl border p-4">Option 3. Walkable Location</div>
      </div>
    </section>
  );
}
```

```tsx
// app/benchmark/page.tsx
import { BenchmarkWorkspace } from "@/components/benchmark/benchmark-workspace";

export default function BenchmarkPage() {
  return <BenchmarkWorkspace />;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit components/benchmark/__tests__/benchmark-workspace.test.tsx`

Expected: PASS with `1 passed`.

**Step 5: Commit**

```bash
git add app/benchmark/page.tsx components/benchmark/benchmark-workspace.tsx components/benchmark/benchmark-form.tsx components/benchmark/option-score-card.tsx components/benchmark/assessment-summary.tsx components/benchmark/__tests__/benchmark-workspace.test.tsx
git commit -m "feat: add LTc3 benchmark workspace shell"
```

### Task 6: Add Google Map Rendering, 400m/800m Circles, And Route Visualization

**Files:**
- Modify: `package.json`
- Create: `components/benchmark/google-map-panel.tsx`
- Create: `components/benchmark/use-google-map.ts`
- Create: `components/benchmark/map-legend.tsx`
- Modify: `components/benchmark/benchmark-workspace.tsx`
- Test: `components/benchmark/__tests__/google-map-panel.test.tsx`

**Step 1: Write the failing test**

```tsx
// components/benchmark/__tests__/google-map-panel.test.tsx
import { render, screen } from "@testing-library/react";
import { GoogleMapPanel } from "@/components/benchmark/google-map-panel";

describe("GoogleMapPanel", () => {
  it("shows the 400m and 800m overlays in the legend", () => {
    render(
      <GoogleMapPanel
        project={{ lat: 40.7915, lng: -73.9680, label: "Project Entry" }}
        routes={[]}
      />
    );

    expect(screen.getByText("400m walking circle")).toBeInTheDocument();
    expect(screen.getByText("800m walking circle")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit components/benchmark/__tests__/google-map-panel.test.tsx`

Expected: FAIL because `GoogleMapPanel` does not exist.

**Step 3: Write minimal implementation**

Add the official JS loader dependency.

```json
{
  "dependencies": {
    "@googlemaps/js-api-loader": "^1.16.8"
  }
}
```

```tsx
// components/benchmark/google-map-panel.tsx
export function GoogleMapPanel() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>400m walking circle</span>
        <span>800m walking circle</span>
      </div>
      <div className="aspect-[4/3] rounded-lg bg-muted" />
    </div>
  );
}
```

During the full implementation of this step, replace the placeholder with a real Google map that:

- loads using `@googlemaps/js-api-loader`
- places the project marker
- draws two `google.maps.Circle` overlays for `400` and `800`
- draws selected walking route polylines
- keeps the 400m circle visible on first paint after analysis completes

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit components/benchmark/__tests__/google-map-panel.test.tsx`

Expected: PASS with `1 passed`.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml components/benchmark/google-map-panel.tsx components/benchmark/use-google-map.ts components/benchmark/map-legend.tsx components/benchmark/benchmark-workspace.tsx components/benchmark/__tests__/google-map-panel.test.tsx
git commit -m "feat: render Google map analysis for LTc3"
```

### Task 7: Add Review Tables, Recalculation, And Downloadable Evidence Bundle

**Files:**
- Create: `components/benchmark/places-review-table.tsx`
- Create: `components/benchmark/transit-review-table.tsx`
- Create: `components/benchmark/density-review-table.tsx`
- Create: `components/benchmark/download-evidence-button.tsx`
- Modify: `components/benchmark/benchmark-workspace.tsx`
- Modify: `components/benchmark/assessment-summary.tsx`
- Test: `components/benchmark/__tests__/review-flow.test.tsx`

**Step 1: Write the failing test**

```tsx
// components/benchmark/__tests__/review-flow.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { BenchmarkWorkspace } from "@/components/benchmark/benchmark-workspace";

describe("review flow", () => {
  it("recalculates the summary when an item is excluded", async () => {
    render(<BenchmarkWorkspace />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /count grocery/i }));
    expect(await screen.findByText("Total LTc3 Points")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit components/benchmark/__tests__/review-flow.test.tsx`

Expected: FAIL because there is no review UI or recalculation state.

**Step 3: Write minimal implementation**

```tsx
// components/benchmark/download-evidence-button.tsx
export function DownloadEvidenceButton() {
  return (
    <button type="button" className="inline-flex rounded-md border px-4 py-2 text-sm">
      Download Evidence Bundle
    </button>
  );
}
```

During the full implementation of this step:

- keep raw API results in client state
- store manual overrides separately from raw evidence
- recompute `option1`, `option2`, `option3`, and `totalPoints` from pure scoring functions after every override
- expose download actions only after one successful assessment run
- POST reviewed assessment data to `/api/benchmark/evidence`

**Step 4: Run test to verify it passes**

Run: `pnpm test:unit components/benchmark/__tests__/review-flow.test.tsx`

Expected: PASS with the summary updating after override state changes.

**Step 5: Commit**

```bash
git add components/benchmark/places-review-table.tsx components/benchmark/transit-review-table.tsx components/benchmark/density-review-table.tsx components/benchmark/download-evidence-button.tsx components/benchmark/benchmark-workspace.tsx components/benchmark/assessment-summary.tsx components/benchmark/__tests__/review-flow.test.tsx
git commit -m "feat: add LTc3 review workflow and evidence download"
```

### Task 8: Verify End-To-End Behavior, Document Setup, And Prepare For Review

**Files:**
- Modify: `README.md`
- Create: `.env.example`
- Create: `docs/benchmark-ltc3.md`
- Modify: `app/api/walkscore/route.ts`
- Test: `lib/benchmark/ltc3/__tests__/assessment.test.ts`
- Test: `components/benchmark/__tests__/benchmark-workspace.test.tsx`
- Test: `components/benchmark/__tests__/google-map-panel.test.tsx`
- Test: `components/benchmark/__tests__/review-flow.test.tsx`

**Step 1: Write the failing test**

Add a regression test that asserts unsupported Walk Score does not block the fallback use-count path.

```ts
it("falls back to place-based walkability when Walk Score is unavailable", async () => {
  const result = await assessLtc3({
    walkScore: null,
    qualifiedUses: [
      { placeId: "1", useType: "grocery_with_produce", category: "food retail" },
      { placeId: "2", useType: "bank", category: "services" },
      { placeId: "3", useType: "park", category: "community resources" },
      { placeId: "4", useType: "restaurant", category: "community-serving retail" },
    ],
  });

  expect(result.option3.points).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:unit lib/benchmark/ltc3/__tests__/assessment.test.ts`

Expected: FAIL because the fallback path is incomplete or mis-scored.

**Step 3: Write minimal implementation**

Document the operational contract after the fallback test passes.

```env
# .env.example
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-browser-key
GOOGLE_MAPS_API_KEY=your-server-key
TRANSITLAND_API_KEY=your-transitland-key
```

```md
<!-- docs/benchmark-ltc3.md -->
- Enable Maps JavaScript API, Places API, Routes API, Geocoding API, and Maps Static API.
- Transit totals come from Transitland scheduled departures.
- Overpass seeds surrounding-density geometry; analysts must review dwelling-unit and floor assumptions before final export.
```

**Step 4: Run test to verify it passes**

Run these commands in order:

1. `pnpm test:unit`
2. `pnpm lint`
3. `pnpm build`

Expected:

- all unit tests PASS
- lint exits `0`
- Next.js build succeeds without type errors

**Step 5: Commit**

```bash
git add README.md .env.example docs/benchmark-ltc3.md app/api/walkscore/route.ts lib/benchmark/ltc3/__tests__/assessment.test.ts
git commit -m "docs: finalize LTc3 benchmark setup and verification"
```

### Execution Notes

- Run this plan from the repository root: `leed_feasibility/`
- Do not overwrite the user's existing changes in `components/navbar.tsx`, `package.json`, `pnpm-lock.yaml`, `app/api/walkscore/route.ts`, `app/benchmark/page.tsx`, or `components/ui/tabs.tsx`; read and integrate with them.
- Prefer server-side fetch wrappers for all third-party APIs so browser keys stay scoped to map rendering only.
- Keep LEED rules pure and framework-independent in `lib/benchmark/ltc3/`.
- Use `@test-driven-development` before each implementation step, `@verification-before-completion` before claiming success, and `@requesting-code-review` before final merge.
