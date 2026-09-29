export type GeoPosition = { lat: number; lon: number };

export function getCurrentPosition(timeoutMs = 10_000): Promise<GeoPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

// Shop kiosk location — replace with Alison's clock-in coordinates once available.
export const SHOP_LOCATION: GeoPosition = { lat: 40.528539, lon: -79.628823 };

const EARTH_RADIUS_MI = 3958.8;

export function haversineDistanceMiles(a: GeoPosition, b: GeoPosition): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export function entryDistanceMiles(
  lat: number | undefined,
  lon: number | undefined,
  shopLocation = SHOP_LOCATION,
): number | null {
  if (lat == null || lon == null) return null;
  if (shopLocation.lat === 0 && shopLocation.lon === 0) return null;
  return Math.round(haversineDistanceMiles({ lat, lon }, shopLocation) * 100) / 100;
}
