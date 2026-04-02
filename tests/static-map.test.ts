import { describe, it, expect } from "vitest";
import {
  buildStaticMapUrl,
  encodeCirclePolyline,
} from "@/lib/static-map";

describe("encodeCirclePolyline", () => {
  it("returns a non-empty encoded string", () => {
    const encoded = encodeCirclePolyline(
      { lat: 40.7649, lng: -73.9794 },
      804.672, // 0.5 mi in meters
      64
    );
    expect(encoded.length).toBeGreaterThan(10);
  });
});

describe("buildStaticMapUrl", () => {
  const projectLocation = { lat: 40.7649, lng: -73.9794 };
  const stations = [
    { name: "57 St", location: { lat: 40.7641, lng: -73.9773 }, index: 1 },
    { name: "59 St", location: { lat: 40.7681, lng: -73.9819 }, index: 2 },
  ];

  it("includes the API key", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("key=TEST_KEY");
  });

  it("includes project location marker", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("markers=");
    expect(url).toContain("40.7649");
  });

  it("includes station markers with labels", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("label%3A1");
    expect(url).toContain("label%3A2");
  });

  it("includes the circle path", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("path=");
    expect(url).toContain("enc%3A");
  });

  it("uses 640x400 size with scale 2", () => {
    const url = buildStaticMapUrl(projectLocation, stations, "TEST_KEY");
    expect(url).toContain("size=640x400");
    expect(url).toContain("scale=2");
  });
});
