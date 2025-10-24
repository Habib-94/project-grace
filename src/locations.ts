// Small helper for Google Places / Geocoding + distance calculation.
// Relies on process/env or Expo Constants for GOOGLE_MAPS_API_KEY.

import Constants from 'expo-constants';

const API_KEY = (Constants.expoConfig?.extra?.googleMapsApiKey as string) ?? (process.env.GOOGLE_MAPS_API_KEY as string) ?? '';

if (!API_KEY) {
  console.warn('[location] No GOOGLE_MAPS_API_KEY found in expo config or env. Place/Geocode requests will fail.');
}

type PlaceDetails = {
  placeId?: string;
  name?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
};

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
      placeId
    )}&fields=name,formatted_address,geometry,place_id&key=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json?.status !== 'OK') {
      console.warn('[location] getPlaceDetails failed', json?.status, json?.error_message);
      return null;
    }
    const r = json.result;
    return {
      placeId: r.place_id,
      name: r.name,
      formattedAddress: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
    };
  } catch (e) {
    console.warn('[location] getPlaceDetails error', e);
    return null;
  }
}

export async function geocodeAddress(text: string): Promise<PlaceDetails | null> {
  if (!API_KEY) return null;
  try {
    // Use Text Search (Places) to get an initial candidate + place_id
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      text
    )}&key=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json?.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) {
      console.warn('[location] geocodeAddress no results', json?.status, json?.error_message);
      return null;
    }
    const r = json.results[0];
    return {
      placeId: r.place_id,
      name: r.name,
      formattedAddress: r.formatted_address ?? r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
    };
  } catch (e) {
    console.warn('[location] geocodeAddress error', e);
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceDetails | null> {
  if (!API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json?.status !== 'OK' || !Array.isArray(json.results) || json.results.length === 0) {
      console.warn('[location] reverseGeocode no results', json?.status, json?.error_message);
      return null;
    }
    const r = json.results[0];
    return {
      formattedAddress: r.formatted_address,
      lat,
      lng,
    };
  } catch (e) {
    console.warn('[location] reverseGeocode error', e);
    return null;
  }
}

/** Haversine distance in kilometers between two points */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}