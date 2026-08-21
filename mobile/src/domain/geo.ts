// GPS / geofencing helpers - deliberate 1:1 port of backend/src/services/geo.js so the mobile
// app's "out of area" warning uses the exact same point-in-polygon algorithm as the server.
// Blok.referensi_polygon in the seeded backend is a real GeoJSON Polygon, so this is a genuine
// boundary check, not just a proximity heuristic - but it degrades gracefully (returns null,
// meaning "cannot determine") when a blok has no polygon on file, which callers should treat as
// "don't warn" (best-effort limitation documented in README.md).

import type { Blok } from '../types';

type Ring = Array<[number, number]>;

function pointInRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}
interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry;
}

export function pointInGeoJSON(lat: number, lng: number, geojson: GeoJsonGeometry | GeoJsonFeature): boolean | null {
  if (!geojson) return null;
  let geom: GeoJsonGeometry = geojson.type === 'Feature' ? (geojson as GeoJsonFeature).geometry : (geojson as GeoJsonGeometry);
  if (!geom || !geom.coordinates) return null;
  const point: [number, number] = [lng, lat];
  if (geom.type === 'Polygon') {
    return pointInRing(point, (geom.coordinates as Ring[])[0]);
  }
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as Ring[][]).some((poly) => pointInRing(point, poly[0]));
  }
  return null; // unsupported geometry type
}

/** Returns true (warn - outside blok), false (ok - inside blok), or null (cannot determine -
 * no cached polygon for this blok, or no GPS fix yet). */
export function checkLocationWarning(blok: Blok | null | undefined, lat: number | null, lng: number | null): boolean | null {
  if (!blok || !blok.referensi_polygon || lat === null || lng === null) return null;
  try {
    const geojson = JSON.parse(blok.referensi_polygon) as GeoJsonGeometry | GeoJsonFeature;
    const inside = pointInGeoJSON(lat, lng, geojson);
    if (inside === null) return null;
    return !inside;
  } catch {
    return null;
  }
}
