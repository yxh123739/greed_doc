/**
 * Maps individual MTA subway route names to the PDF schedule filename in Supabase Storage.
 * Each route maps to its own per-route PDF, except J and Z which share a combined timetable.
 * S shuttle routes use their GTFS route_id: FS (Franklin Av), GS (42 St), H (Rockaway Park).
 */
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
  // Dynamically import supabase client to avoid env var issues in test environment
  const { supabase } = await import("@/lib/supabase/client");

  const results = await Promise.all(
    groups.map(async (group) => {
      const filename = `mta-schedule-${group}.pdf`;
      const { data, error } = await supabase.storage
        .from("mta-schedules")
        // Storage path is just `${group}.pdf` (no prefix); `filename` adds the
        // `mta-schedule-` prefix used as the ZIP entry name returned to callers.
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
