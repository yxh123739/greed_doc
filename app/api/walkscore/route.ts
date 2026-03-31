import { NextRequest, NextResponse } from "next/server";

const WALKSCORE_BASE_URL = "https://www.walkscore.com";

const US_STATE_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

type WalkScorePayload = {
  address?: string;
  city?: string;
  stateProvince?: string;
  zipCode?: string;
  country?: string;
};

function extractNumber(pattern: RegExp, input: string): number | null {
  const found = input.match(pattern)?.[1];
  if (!found) return null;
  const value = Number(found);
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function isLikelyUnitedStates(country: string): boolean {
  const normalized = country.trim().toLowerCase();
  return (
    normalized === "united states" ||
    normalized === "united states of america" ||
    normalized === "us" ||
    normalized === "usa" ||
    normalized === "u.s." ||
    normalized === "u.s.a."
  );
}

function normalizeStateOrProvince(value: string, country: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!isLikelyUnitedStates(country)) return trimmed;

  if (trimmed.length === 2) return trimmed.toUpperCase();

  return US_STATE_TO_ABBR[trimmed.toLowerCase()] ?? trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as WalkScorePayload;

    const address = payload.address?.trim() ?? "";
    const city = payload.city?.trim() ?? "";
    const country = payload.country?.trim() ?? "";
    const stateOrProvince = normalizeStateOrProvince(
      payload.stateProvince ?? "",
      country
    );
    const zipCode = payload.zipCode?.trim() ?? "";

    if (!address || !city) {
      return NextResponse.json(
        { error: "Address and city are required to estimate Walk Score." },
        { status: 400 }
      );
    }

    const fullAddress = [address, city, stateOrProvince, zipCode, country]
      .filter(Boolean)
      .join(", ");

    const queryUrl = `${WALKSCORE_BASE_URL}/score/${encodeURIComponent(fullAddress)}`;

    let html: string;
    let responseUrl: string = "";
    try {
      const response = await fetch(queryUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `Walk Score request failed with status ${response.status}.`,
          },
          { status: 502 }
        );
      }

      responseUrl = response.url ?? "";
      html = await response.text();
    } catch (fetchError) {
      console.error("Walk Score fetch error:", fetchError);
      return NextResponse.json(
        { error: "Could not reach Walk Score service. Please try again." },
        { status: 502 }
      );
    }

    const walkScore =
      extractNumber(/has a Walk Score of\s*(\d{1,3})\s*out of 100/i, html) ??
      extractNumber(/(\d{1,3})\s*Walk Score of/i, html);

    const transitScore =
      extractNumber(/has a Transit Score of\s*(\d{1,3})\s*out of 100/i, html) ??
      extractNumber(/(\d{1,3})\s*Transit Score of/i, html);

    const bikeScore =
      extractNumber(/has a Bike Score of\s*(\d{1,3})\s*out of 100/i, html) ??
      extractNumber(/(\d{1,3})\s*Bike Score of/i, html);

    if (walkScore === null) {
      return NextResponse.json(
        {
          error:
            "Walk Score result not found for this address. Try a more specific address.",
        },
        { status: 404 }
      );
    }

    const canonicalPath =
      html.match(
        /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i
      )?.[1] ?? "";
    const canonicalUrl = responseUrl
      ? responseUrl
      : canonicalPath.startsWith("http")
      ? canonicalPath
      : `${WALKSCORE_BASE_URL}${canonicalPath}`;
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";

    return NextResponse.json({
      walkScore,
      transitScore,
      bikeScore,
      canonicalUrl,
      title,
      queriedAddress: fullAddress,
    });
  } catch (error) {
    console.error("Walk Score proxy error:", error);
    return NextResponse.json(
      { error: "Failed to evaluate Walk Score." },
      { status: 500 }
    );
  }
}
