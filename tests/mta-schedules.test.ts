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

    await expect(fetchSchedulePdfs(["1-2-3"])).rejects.toThrow(
      "Schedule not found: mta-schedule-1-2-3.pdf is missing from storage"
    );
  });

  it("throws when data is null and error is null", async () => {
    const { supabase } = await import("@/lib/supabase/client");
    const mockDownload = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(supabase.storage.from).mockReturnValue({
      download: mockDownload,
    } as any);

    await expect(fetchSchedulePdfs(["A-C-E"])).rejects.toThrow(
      "Schedule not found: mta-schedule-A-C-E.pdf is missing from storage"
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
    expect(results[0].buffer).toEqual(Buffer.from(await fakeBlob.arrayBuffer()));
  });
});
