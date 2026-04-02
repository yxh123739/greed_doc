const STATIC_MAP_BASE = "https://maps.googleapis.com/maps/api/staticmap";
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
 * Build a Google Static Maps URL with:
 * - Blue pin for project location
 * - Purple pins with numeric labels for qualifying stations
 * - Dashed green circle for 0.5 mi radius
 */
export function buildStaticMapUrl(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string
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

  // Station markers (purple with numeric labels)
  for (const station of stations) {
    params.append(
      "markers",
      `color:purple|label:${station.index}|${station.location.lat},${station.location.lng}`
    );
  }

  // 0.5 mi circle
  const circleEncoded = encodeCirclePolyline(projectLocation, 804.672);
  params.append(
    "path",
    `color:0x7cb342aa|weight:2|fillcolor:0x7cb3420a|enc:${circleEncoded}`
  );

  return `${STATIC_MAP_BASE}?${params.toString()}`;
}

/**
 * Fetch the static map image as a Buffer.
 * Throws with descriptive message on failure.
 */
export async function fetchStaticMapImage(
  projectLocation: { lat: number; lng: number },
  stations: StationPin[],
  apiKey: string
): Promise<Buffer> {
  const url = buildStaticMapUrl(projectLocation, stations, apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Map generation failed: Static Maps API returned ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
