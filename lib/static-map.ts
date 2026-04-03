const STATIC_MAP_BASE = "https://maps.googleapis.com/maps/api/staticmap";
const DIRECTIONS_BASE = "https://maps.googleapis.com/maps/api/directions/json";
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
 * Fetch actual walking route polylines from the Directions API for each station.
 * Returns null for any station where the Directions API fails — callers should
 * fall back to a straight line in that case.
 */
async function fetchWalkingPolylines(
  origin: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string
): Promise<(string | null)[]> {
  return Promise.all(
    stations.map(async (station) => {
      try {
        const url =
          `${DIRECTIONS_BASE}?origin=${origin.lat},${origin.lng}` +
          `&destination=${station.location.lat},${station.location.lng}` +
          `&mode=walking&key=${apiKey}`;

        const response = await fetch(url);
        const data = await response.json();

        if (
          data.status !== "OK" ||
          !data.routes?.[0]?.overview_polyline?.points
        ) {
          return null;
        }

        return data.routes[0].overview_polyline.points as string;
      } catch {
        return null;
      }
    })
  );
}

/**
 * Build a Google Static Maps URL with:
 * - Blue pin for project location
 * - Station markers using a custom icon URL (or purple labeled pins as fallback)
 * - Actual walking route polylines (or straight-line fallback) per station
 */
export function buildStaticMapUrl(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  walkingPolylines: (string | null)[],
  apiKey: string,
  stationIconUrl?: string
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

  // Station markers — custom subway icon or fallback to purple numbered pins
  for (const station of stations) {
    const markerSpec = stationIconUrl
      ? `icon:${stationIconUrl}|${station.location.lat},${station.location.lng}`
      : `color:purple|label:${station.index}|${station.location.lat},${station.location.lng}`;
    params.append("markers", markerSpec);
  }

  // Walking routes: encoded polyline from Directions API, or straight-line fallback
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    const polyline = walkingPolylines[i];

    if (polyline) {
      params.append("path", `color:0x4285F4CC|weight:4|enc:${polyline}`);
    } else {
      params.append(
        "path",
        `color:0x4285F4CC|weight:4|${projectLocation.lat},${projectLocation.lng}|${station.location.lat},${station.location.lng}`
      );
    }
  }

  return `${STATIC_MAP_BASE}?${params.toString()}`;
}

/**
 * Fetch the static map image as a Buffer.
 * Internally fetches actual walking routes from the Directions API first,
 * then builds the map URL with encoded polylines.
 * Provide `appBaseUrl` (e.g. "https://example.com") to use the custom
 * subway icon from /subway.png; omit to fall back to default purple pins.
 * Throws with descriptive message on map fetch failure.
 */
export async function fetchStaticMapImage(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string,
  appBaseUrl?: string
): Promise<Buffer> {
  const walkingPolylines = await fetchWalkingPolylines(
    projectLocation,
    stations,
    apiKey
  );

  const stationIconUrl = appBaseUrl ? `${appBaseUrl}/subway.png` : undefined;

  const url = buildStaticMapUrl(
    projectLocation,
    stations,
    walkingPolylines,
    apiKey,
    stationIconUrl
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Map generation failed: Static Maps API returned ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
