// GIS containment check (SPEC_V2.md section 1 item 9 / section 4 Backend module list).
// Generalizes services/geo.js's point-in-polygon (ray casting, no native/GIS dependency) so it
// can be applied to GPS coming from ANY V2 entity (yield making, defisiensi hara, action plan
// evidence, ...), not just detection/sensus. The actual ray-casting math already lives in
// services/geo.js (built in V1) -- this module re-exports it under the V2-spec'd file name and
// adds a small helper for "resolve blok by id, then check" since most new routes only have a
// blok_id + lat/lng on hand, not the blok row itself.

const db = require('../db/db');
const { pointInGeoJSON, checkLocationWarning } = require('./geo');

/**
 * @param {number} blok_id
 * @param {number|string|null|undefined} lat
 * @param {number|string|null|undefined} lng
 * @returns {boolean|null} true = outside polygon (warn), false = inside/ok, null = cannot determine
 *   (no polygon on file for this blok, or no GPS supplied).
 */
function checkContainmentByBlokId(blok_id, lat, lng) {
  if (!blok_id) return null;
  const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(blok_id);
  return checkLocationWarning(blok, lat, lng);
}

module.exports = { pointInGeoJSON, checkLocationWarning, checkContainmentByBlokId };
