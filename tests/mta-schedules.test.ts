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
