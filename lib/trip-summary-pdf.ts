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
    doc.text(h, colX[i], headerY + 4, { width: colW[i], align });
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

      // Page overflow detection
      const PAGE_HEIGHT = doc.page.height;
      const BOTTOM_MARGIN = doc.page.margins.bottom;
      if (doc.y > PAGE_HEIGHT - BOTTOM_MARGIN - 80) {
        doc.addPage();
      }
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
