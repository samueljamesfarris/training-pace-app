/** Mean Earth radius in meters (IUGG). */
const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance between two fixes, in meters. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Move a lat/lon by a distance along a bearing. Used by the simulator. */
export function project(
  lat: number,
  lon: number,
  bearingDeg: number,
  meters: number,
): { lat: number; lon: number } {
  const toRad = Math.PI / 180;
  const dR = meters / EARTH_RADIUS_M;
  const br = bearingDeg * toRad;
  const lat1 = lat * toRad;
  const lon1 = lon * toRad;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 / toRad, lon: lon2 / toRad };
}
