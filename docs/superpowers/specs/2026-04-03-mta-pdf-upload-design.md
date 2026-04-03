# MTA Schedule PDF Upload — Design Spec

**Date:** 2026-04-03  
**Status:** Approved

## Background

The LEED transit report ZIP bundle includes MTA schedule PDFs as evidence for the verifier. The original plan assumed MTA publishes grouped PDFs (e.g., `1-2-3.pdf`), but MTA actually publishes per-route PDFs. 25 individual PDFs have been downloaded to `public/pdf/`.

The existing `lib/mta-schedules.ts` grouped routes into 11 combined storage keys. This design replaces that with per-route storage to match the actual MTA publication format.

## Scope

1. New upload script: reads `public/pdf/`, uploads each file to Supabase Storage `mta-schedules` bucket under a standardized name.
2. Updated `ROUTE_TO_SCHEDULE` mapping: per-route instead of per-group.
3. Updated tests: reflect new mapping, add S shuttle coverage.

No changes to `fetchSchedulePdfs`, `app/api/transit/download/route.ts`, or any other file.

## Storage Filename Convention

Files in `public/pdf/` follow the pattern `{ROUTE} timetable {DATE}.pdf`. The storage key is derived by:
- Taking the prefix before ` timetable`
- Replacing spaces with `-`

| Local file | Storage key | Storage path |
|---|---|---|
| `1 timetable 2025-11-02.pdf` | `1` | `1.pdf` |
| `2 timetable 2025-11-02.pdf` | `2` | `2.pdf` |
| `3 timetable 2026-03-01.pdf` | `3` | `3.pdf` |
| `4 timetable 2026-03-01.pdf` | `4` | `4.pdf` |
| `5 timetable 2025-11-02.pdf` | `5` | `5.pdf` |
| `6 timetable 2025-11-02.pdf` | `6` | `6.pdf` |
| `7 timetable 2025-11-02.pdf` | `7` | `7.pdf` |
| `A timetable 2025-11-02.pdf` | `A` | `A.pdf` |
| `B timetable 2025-11-02.pdf` | `B` | `B.pdf` |
| `C timetable 2025-11-02.pdf` | `C` | `C.pdf` |
| `D timetable 2025-11-02.pdf` | `D` | `D.pdf` |
| `E timetable 2025-11-02.pdf` | `E` | `E.pdf` |
| `F timetable 2025-12-08.pdf` | `F` | `F.pdf` |
| `FS timetable 2025-11-02.pdf` | `FS` | `FS.pdf` |
| `G timetable 2025-11-02.pdf` | `G` | `G.pdf` |
| `GS timetable 2025-11-02.pdf` | `GS` | `GS.pdf` |
| `H timetable 2025-11-02.pdf` | `H` | `H.pdf` |
| `J Z timetable 2025-12-08.pdf` | `J-Z` | `J-Z.pdf` |
| `L timetable 2025-11-02.pdf` | `L` | `L.pdf` |
| `M timetable 2025-12-08.pdf` | `M` | `M.pdf` |
| `N timetable 2025-11-02.pdf` | `N` | `N.pdf` |
| `Q timetable 2025-11-02.pdf` | `Q` | `Q.pdf` |
| `R timetable 2025-11-02.pdf` | `R` | `R.pdf` |
| `SIR timetable 2025-11-02_0.pdf` | `SIR` | `SIR.pdf` |
| `W timetable 2025-11-02.pdf` | `W` | `W.pdf` |

25 files total. `J Z` → `J-Z` is the only space-to-hyphen conversion needed.

## Updated ROUTE_TO_SCHEDULE Mapping

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

Note: J and Z share `J-Z.pdf` because MTA publishes them as a single combined timetable. FS/GS/H are the three S shuttle routes (Franklin Av, 42 St, Rockaway Park) identified by their GTFS route_id.

## Upload Script (`scripts/upload-mta-schedules.ts`)

- Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env
- Reads all `*.pdf` files from `public/pdf/`
- Derives storage key: `filename.replace(/ timetable .+\.pdf$/, "").replace(/ /g, "-")`
- Uploads to `mta-schedules` bucket with `upsert: true`
- Logs each upload result; exits non-zero on any failure

Run: `npx tsx scripts/upload-mta-schedules.ts`

## Test Updates (`tests/mta-schedules.test.ts`)

- Update "maps every NYC subway route" test to include FS, GS, H
- Update deduplication test: `["1", "2", "3"]` → three distinct groups (`"1"`, `"2"`, `"3"`)
- Update filename assertions: `mta-schedule-1-2-3.pdf` → `mta-schedule-1.pdf`

## Out of Scope

- Bus routes (M5, M7, etc.) — separate future task
- Verifying S shuttle route_short_name in Supabase GTFS data — if FS/GS/H are stored differently, `ROUTE_TO_SCHEDULE` keys may need adjustment
