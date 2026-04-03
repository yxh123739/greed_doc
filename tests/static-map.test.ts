import { describe, it, expect } from "vitest";
import {
  buildStaticMapUrl,
  encodeCirclePolyline,
} from "@/lib/static-map";

const PROJECT = { lat: 40.7649, lng: -73.9794 };
const STATIONS = [
  { name: "57 St", location: { lat: 40.7641, lng: -73.9773 }, index: 1 },
  { name: "59 St", location: { lat: 40.7681, lng: -73.9819 }, index: 2 },
];

describe("encodeCirclePolyline", () => {
  it("returns a non-empty encoded string", () => {
    const encoded = encodeCirclePolyline(PROJECT, 804.672, 64);
    expect(encoded.length).toBeGreaterThan(10);
  });
});

describe("buildStaticMapUrl", () => {
  it("includes the API key", () => {
    const url = buildStaticMapUrl(PROJECT, STATIONS, [null, null], "TEST_KEY");
    expect(url).toContain("key=TEST_KEY");
  });

  it("includes project location marker", () => {
    const url = buildStaticMapUrl(PROJECT, STATIONS, [null, null], "TEST_KEY");
    expect(url).toContain("markers=");
    expect(url).toContain("40.7649");
  });

  it("includes station markers with labels", () => {
    const url = buildStaticMapUrl(PROJECT, STATIONS, [null, null], "TEST_KEY");
    expect(url).toContain("label%3A1");
    expect(url).toContain("label%3A2");
  });

  it("uses encoded polyline when walking route is available", () => {
    const fakePolyline = "abc123encodedpolyline";
    const url = buildStaticMapUrl(PROJECT, STATIONS, [fakePolyline, null], "TEST_KEY");
    expect(url).toContain(`enc%3A${fakePolyline}`);
  });

  it("falls back to straight line when walking route is null", () => {
    const url = buildStaticMapUrl(PROJECT, STATIONS, [null, null], "TEST_KEY");
    // straight line includes both origin and destination coordinates
    expect(url).toContain("40.7649");
    expect(url).toContain("40.7641"); // station 1 lat
  });

  it("uses 640x400 size with scale 2", () => {
    const url = buildStaticMapUrl(PROJECT, STATIONS, [null, null], "TEST_KEY");
    expect(url).toContain("size=640x400");
    expect(url).toContain("scale=2");
  });
});
