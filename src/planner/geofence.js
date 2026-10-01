/**
 * Operating-area geofence for Vahak-1, shared by the gateway (enforcement) and the map (drawing).
 *
 * The border line is the app's approximate, hand-digitised International Border (sector labels are
 * indicative); it is not survey data. Enforcement keeps the aircraft BORDER_BUFFER_NM inside it and
 * inside the operating box, looking LOOKAHEAD_S ahead along the current track.
 */
export const STATION = { lat: 26.45, lon: 70.52, radiusM: 5000 };   // Vahak-1 patrol orbit

export const GEOFENCE_RULES = { BORDER_BUFFER_NM: 5, LOOKAHEAD_S: 120 };

// Operating box (approximate). Its west edge reaches past the border line at some latitudes, so the
// border buffer — not the box — is the binding limit there.
export const GEOFENCE_POLYGON = [
  [25.3000, 70.1000],
  [27.5000, 70.1000],
  [27.5000, 72.2000],
  [25.3000, 72.2000],
];

// Indo-Pak International Border (IB), approximate, ordered south-west -> north-east
export const INDO_PAK_BORDER = [
  [23.7000, 68.2000],
  [24.1500, 68.8000],
  [24.5500, 69.4500],
  [24.9500, 70.3000],
  [25.4000, 70.2800], // Munabao Border Sector
  [25.7500, 70.2500], // Gadra Road
  [26.1500, 70.1800], // Khokhropar / Barmer West Sector
  [26.5500, 70.2200], // Jaisalmer SW Sector
  [26.9000, 70.1500], // Longewala / Tanot Sector
  [27.3500, 70.4000], // Kishangarh Fort Sector
  [27.8500, 71.0000], // West of Bikaner
  [28.3000, 71.5500], // Anupgarh Sector
  [28.8500, 72.3000], // Sri Ganganagar Sector
  [29.4000, 72.9000],
  [30.1000, 73.5000], // Fazilka Sector
  [30.8500, 74.3000], // Ferozepur / Hussainiwala
  [31.6000, 74.5700], // Wagah / Attari Border
  [32.0500, 74.9000], // Dera Baba Nanak
  [32.3500, 75.0500], // Shakargarh Bulge
];

const M_PER_DEG = 111320;
const NM = 1852;
const COS0 = Math.cos(STATION.lat * Math.PI / 180);

/** 6-DOF local frame (metres north/east of the station) <-> lat/lon, same mapping as the gateway. */
export const localToLatLon = (north_m, east_m) => ({ lat: STATION.lat + north_m / M_PER_DEG, lon: STATION.lon + east_m / (M_PER_DEG * COS0) });
const toXY = (lat, lon) => ({ x: (lon - STATION.lon) * M_PER_DEG * COS0, y: (lat - STATION.lat) * M_PER_DEG });
const BORDER_XY = INDO_PAK_BORDER.map(([la, lo]) => toXY(la, lo));

/** Signed distance to the border line in NM: positive on the Indian (east/south-east) side, negative beyond it. */
export function borderDistanceNm(lat, lon) {
  const p = toXY(lat, lon);
  let best = Infinity, side = 1;
  for (let i = 0; i < BORDER_XY.length - 1; i++) {
    const a = BORDER_XY[i], b = BORDER_XY[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) {
      best = d;
      // segment runs SW -> NE; the Indian side is to its right (negative cross product)
      side = (dx * (p.y - a.y) - dy * (p.x - a.x)) < 0 ? 1 : -1;
    }
  }
  return side * best / NM;
}

export function insideOperatingArea(lat, lon) {
  let inside = false;
  const P = GEOFENCE_POLYGON;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [yi, xi] = P[i], [yj, xj] = P[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Geofence state for the aircraft at local position (north/east m), heading (deg) and ground speed (m/s). */
export function geofenceCheck({ north_m, east_m, headingDeg, speedMs }) {
  const R = GEOFENCE_RULES;
  const here = localToLatLon(north_m, east_m);
  const h = (headingDeg * Math.PI) / 180;
  const d = speedMs * R.LOOKAHEAD_S;
  const ahead = localToLatLon(north_m + d * Math.cos(h), east_m + d * Math.sin(h));
  const borderNm = borderDistanceNm(here.lat, here.lon);
  const aheadBorderNm = borderDistanceNm(ahead.lat, ahead.lon);
  const inside = insideOperatingArea(here.lat, here.lon);
  const aheadInside = insideOperatingArea(ahead.lat, ahead.lon);
  const reasons = [];
  if (borderNm < R.BORDER_BUFFER_NM) reasons.push(`${borderNm.toFixed(1)} NM from the border (minimum ${R.BORDER_BUFFER_NM} NM)`);
  else if (aheadBorderNm < R.BORDER_BUFFER_NM) reasons.push(`current track reaches the ${R.BORDER_BUFFER_NM} NM border buffer within ${R.LOOKAHEAD_S / 60} min`);
  if (!inside) reasons.push('outside the operating area');
  else if (!aheadInside) reasons.push(`current track leaves the operating area within ${R.LOOKAHEAD_S / 60} min`);
  return { lat: here.lat, lon: here.lon, borderNm, aheadBorderNm, inside, aheadInside, breach: reasons.length > 0, reasons };
}

/** Check a route (local-frame waypoints {north, east}) from the current position, sampled every 500 m. */
export function validateRoute(fromNorth, fromEast, waypoints) {
  const pts = [{ north: fromNorth, east: fromEast }, ...waypoints];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.north - a.north, b.east - a.east) / 500));
    for (let k = 0; k <= steps; k++) {
      const n = a.north + (b.north - a.north) * k / steps, e = a.east + (b.east - a.east) * k / steps;
      const { lat, lon } = localToLatLon(n, e);
      const bd = borderDistanceNm(lat, lon);
      if (bd < GEOFENCE_RULES.BORDER_BUFFER_NM) return { ok: false, reason: `route passes ${bd.toFixed(1)} NM from the border at waypoint leg ${i + 1} (minimum ${GEOFENCE_RULES.BORDER_BUFFER_NM} NM)` };
      if (!insideOperatingArea(lat, lon)) return { ok: false, reason: `route leaves the operating area on leg ${i + 1}` };
    }
  }
  return { ok: true };
}
