// Minimal GPS/geofencing helpers (SPEC.md section 6 "GPS" warning + section 7 GIS).
// No external GIS dependency — a small ray-casting point-in-polygon is enough for v1 blok
// boundary checks against an uploaded/edited GeoJSON polygon.

/** @param {[number,number]} point [lng,lat] @param {Array<[number,number]>} ring */
function pointInRing(point, ring) {
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

/** Accepts a GeoJSON Polygon or MultiPolygon geometry (or a Feature wrapping one). */
function pointInGeoJSON(lat, lng, geojson) {
  if (!geojson) return null;
  let geom = geojson;
  if (geom.type === 'Feature') geom = geom.geometry;
  if (!geom || !geom.coordinates) return null;
  const point = [lng, lat];
  if (geom.type === 'Polygon') {
    return pointInRing(point, geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInRing(point, poly[0]));
  }
  return null; // unsupported geometry type -> cannot determine
}

/**
 * Returns true (warn) / false (ok) / null (cannot determine - no polygon on file).
 * blok.referensi_polygon is expected to be a GeoJSON geometry/Feature JSON string.
 */
function checkLocationWarning(blok, lat, lng) {
  if (!blok || !blok.referensi_polygon || lat === undefined || lng === undefined || lat === null || lng === null) {
    return null;
  }
  try {
    const geojson = JSON.parse(blok.referensi_polygon);
    const inside = pointInGeoJSON(Number(lat), Number(lng), geojson);
    if (inside === null) return null;
    return !inside; // warning = TRUE when outside
  } catch (e) {
    return null;
  }
}

module.exports = { pointInGeoJSON, checkLocationWarning };
