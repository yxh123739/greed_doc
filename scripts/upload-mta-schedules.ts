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

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      console.error(`  ✗ ${filename}: Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }

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

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
