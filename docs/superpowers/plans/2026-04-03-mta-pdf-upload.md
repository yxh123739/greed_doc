# MTA Schedule PDF Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload 25 per-route MTA timetable PDFs to Supabase Storage and update the route→filename mapping from grouped to per-route.

**Architecture:** Update `ROUTE_TO_SCHEDULE` in `lib/mta-schedules.ts` to map each route to its own storage file, then write an upload script that reads `public/pdf/`, derives the storage key from each filename, and upserts into the `mta-schedules` bucket. Tests are updated with TDD before changing production code.

**Tech Stack:** TypeScript, `@supabase/supabase-js`, `tsx`, Vitest

---

### Task 1: Update tests to reflect per-route mapping

**Files:**
- Modify: `tests/mta-schedules.test.ts`

- [ ] **Step 1: Replace the test file with updated assertions**

Open `tests/mta-schedules.test.ts` and replace the entire file content with:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  getScheduleGroups,
  ROUTE_TO_SCHEDULE,
  fetchSchedulePdfs,
} from "@/lib/mta-schedules";

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    storage: {
      from: vi.fn(),
    },
  },
}));

describe("ROUTE_TO_SCHEDULE", () => {
  it("maps every NYC subway route to a schedule group", () => {
    const allRoutes = [
      "1","2","3","4","5","6","7",
      "A","C","E","B","D","F","M",
      "G","J","Z","L",
      "N","Q","R","W","SIR",
      "FS","GS","H",
    ];
    for (const route of allRoutes) {
      expect(ROUTE_TO_SCHEDULE[route]).toBeDefined();
    }
  });

  it("maps each numeric route to its own individual schedule", () => {
    expect(ROUTE_TO_SCHEDULE["1"]).toBe("1");
    expect(ROUTE_TO_SCHEDULE["2"]).toBe("2");
    expect(ROUTE_TO_SCHEDULE["3"]).toBe("3");
  });

  it("maps J and Z to the shared J-Z schedule", () => {
    expect(ROUTE_TO_SCHEDULE["J"]).toBe("J-Z");
    expect(ROUTE_TO_SCHEDULE["Z"]).toBe("J-Z");
  });

  it("maps S shuttle routes to their individual schedules", () => {
    expect(ROUTE_TO_SCHEDULE["FS"]).toBe("FS");
    expect(ROUTE_TO_SCHEDULE["GS"]).toBe("GS");
    expect(ROUTE_TO_SCHEDULE["H"]).toBe("H");
  });
});

describe("getScheduleGroups", () => {
  it("returns one group per route for routes with individual PDFs", () => {
    const groups = getScheduleGroups(["1", "2", "3"]);
    expect(groups).toHaveLength(3);
    expect(groups).toContain("1");
    expect(groups).toContain("2");
    expect(groups).toContain("3");
  });

  it("deduplicates J and Z (share the same PDF)", () => {
    const groups = getScheduleGroups(["J", "Z"]);
    expect(groups).toEqual(["J-Z"]);
  });

  it("returns multiple groups for routes on different PDFs", () => {
    const groups = getScheduleGroups(["1", "A", "L"]);
    expect(groups).toHaveLength(3);
    expect(groups).toContain("1");
    expect(groups).toContain("A");
    expect(groups).toContain("L");
  });

  it("skips routes not in the mapping", () => {
    const groups = getScheduleGroups(["1", "UNKNOWN_ROUTE"]);
    expect(groups).toEqual(["1"]);
  });

  it("returns empty array for empty input", () => {
    expect(getScheduleGroups([])).toEqual([]);
  });
});

describe("fetchSchedulePdfs", () => {
  it("returns empty array for empty input without calling Supabase", async () => {
    const results = await fetchSchedulePdfs([]);
    expect(results).toEqual([]);
  });

  it("throws when Supabase storage returns an error", async () => {
    const { supabase } = await import("@/lib/supabase/client");
    const mockDownload = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("not found"),
    });
    vi.mocked(supabase.storage.from).mockReturnValue({
      download: mockDownload,
    } as any);

    await expect(fetchSchedulePdfs(["1"])).rejects.toThrow(
      "Schedule not found: mta-schedule-1.pdf is missing from storage"
    );
  });

  it("returns correct filename and buffer for successful fetch", async () => {
    const { supabase } = await import("@/lib/supabase/client");
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])]);
    const mockDownload = vi.fn().mockResolvedValue({
      data: fakeBlob,
      error: null,
    });
    vi.mocked(supabase.storage.from).mockReturnValue({
      download: mockDownload,
    } as any);

    const results = await fetchSchedulePdfs(["L"]);
    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe("mta-schedule-L.pdf");
    expect(Buffer.isBuffer(results[0].buffer)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npx vitest run tests/mta-schedules.test.ts
```

Expected output: several FAIL — `ROUTE_TO_SCHEDULE["FS"]` undefined, `["1","2","3"]` returns `["1-2-3"]` instead of 3 items, etc.

---

### Task 2: Update ROUTE_TO_SCHEDULE mapping

**Files:**
- Modify: `lib/mta-schedules.ts`

- [ ] **Step 1: Replace ROUTE_TO_SCHEDULE in `lib/mta-schedules.ts`**

Find the `ROUTE_TO_SCHEDULE` constant (lines 5–17) and replace it:

```typescript
export const ROUTE_TO_SCHEDULE: Record<string, string> = {
  "1": "1", "2": "2", "3": "3",
  "4": "4", "5": "5", "6": "6",
  "7": "7",
  "A": "A", "C": "C", "E": "E",
  "B": "B", "D": "D", "F": "F", "M": "M",
  "G": "G",
  "J": "J-Z", "Z": "J-Z",
  "L": "L",
  "N": "N", "Q": "Q", "R": "R", "W": "W",
  "FS": "FS", "GS": "GS", "H": "H",
  "SIR": "SIR",
};
```

Also update the JSDoc comment above it to:

```typescript
/**
 * Maps individual MTA subway route names to the PDF schedule filename in Supabase Storage.
 * Each route maps to its own per-route PDF, except J and Z which share a combined timetable.
 * S shuttle routes use their GTFS route_id: FS (Franklin Av), GS (42 St), H (Rockaway Park).
 */
```

- [ ] **Step 2: Run tests — expect all passing**

```bash
npx vitest run tests/mta-schedules.test.ts
```

Expected output: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/mta-schedules.ts tests/mta-schedules.test.ts
git commit -m "feat: switch ROUTE_TO_SCHEDULE to per-route PDF mapping, add FS/GS/H shuttles"
```

---

### Task 3: Write the upload script

**Files:**
- Create: `scripts/upload-mta-schedules.ts`

- [ ] **Step 1: Create the script**

```typescript
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "mta-schedules";
const PDF_DIR = path.resolve(process.cwd(), "public/pdf");

/**
 * Derives the Supabase storage filename from a local PDF filename.
 * e.g. "J Z timetable 2025-12-08.pdf" → "J-Z.pdf"
 *      "SIR timetable 2025-11-02_0.pdf" → "SIR.pdf"
 */
function toStorageName(filename: string): string {
  const key = filename
    .replace(/ timetable .+\.pdf$/i, "")
    .replace(/ /g, "-");
  return `${key}.pdf`;
}

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.endsWith(".pdf"));

  if (files.length === 0) {
    console.error(`No PDF files found in ${PDF_DIR}`);
    process.exit(1);
  }

  console.log(`Uploading ${files.length} PDFs to bucket "${BUCKET}"...\n`);

  let failed = 0;

  for (const filename of files) {
    const storageName = toStorageName(filename);
    const filePath = path.join(PDF_DIR, filename);
    const buffer = fs.readFileSync(filePath);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storageName, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) {
      console.error(`  ✗ ${filename} → ${storageName}: ${error.message}`);
      failed++;
    } else {
      console.log(`  ✓ ${filename} → ${storageName}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} upload(s) failed.`);
    process.exit(1);
  }

  console.log("\nAll uploads complete.");
}

main();
```

- [ ] **Step 2: Run the upload script**

Set env vars from your `.env.local`, then run:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://<your-project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
npx tsx scripts/upload-mta-schedules.ts
```

Expected output:
```
Uploading 25 PDFs to bucket "mta-schedules"...

  ✓ 1 timetable 2025-11-02.pdf → 1.pdf
  ✓ 2 timetable 2025-11-02.pdf → 2.pdf
  ...
  ✓ W timetable 2025-11-02.pdf → W.pdf

All uploads complete.
```

If any file fails with "Bucket not found", create the bucket first in Supabase Dashboard → Storage → New bucket → name: `mta-schedules`, public: false.

- [ ] **Step 3: Commit**

```bash
git add scripts/upload-mta-schedules.ts
git commit -m "feat: add upload script for per-route MTA schedule PDFs"
```

---

### Task 4: Run full test suite

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run
```

Expected: all tests pass. No regressions in other test files.

- [ ] **Step 2: Commit if there are no issues**

If all tests pass, no additional commit needed. If something broke, fix it before proceeding.
