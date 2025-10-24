import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { listTopLevelCollection } from '../../src/firestoreRest';
import { haversineDistanceKm } from '../../src/locations';

const KM_TO_MILES = 0.621371;

export default function FindGamesScreen() {
  const router = useRouter();
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusMiles, setRadiusMiles] = useState<number>(10); // default 10 miles
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingLocation(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission not granted');
          Toast.show({ type: 'info', text1: 'Location permission required to find nearby games' });
          setLoadingLocation(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e: any) {
        console.warn('[FindGames] getCurrentPosition failed', e);
        setError(String(e?.message ?? e));
      } finally {
        setLoadingLocation(false);
      }
    })();
  }, []);

  // Helpers to cope with native SDK return shapes and Firestore REST shapes (mapValue/doubleValue etc).
  const extractIdFromResourceName = (name?: string) => {
    if (!name) return null;
    // resource name like: projects/PROJECT_ID/databases/(default)/documents/teams/{docId}
    const parts = name.split('/');
    return parts[parts.length - 1] || null;
  };

  const readNumberField = (doc: any, fieldName: string): number | null => {
    if (!doc) return null;
    // 1) direct property (native SDK shape)
    const v1 = doc[fieldName];
    if (typeof v1 === 'number') return v1;
    if (typeof v1 === 'string' && v1.trim() !== '' && !Number.isNaN(Number(v1))) return Number(v1);

    // 2) nested location object (doc.location?.lat)
    if (doc.location && typeof doc.location === 'object') {
      const lat = fieldName === 'lat' ? doc.location.lat ?? doc.location.latitude : undefined;
      if (typeof lat === 'number') return lat;
    }

    // 3) Firestore REST JSON shape: doc.fields?.<fieldName>.(doubleValue|integerValue|stringValue)
    const f = doc.fields?.[fieldName];
    if (f) {
      if (f.doubleValue != null) return Number(f.doubleValue);
      if (f.integerValue != null) return Number(f.integerValue);
      if (f.stringValue != null && f.stringValue.trim() !== '') return Number(f.stringValue);
    }

    // 4) Firestore REST nested map for location: doc.fields?.location?.mapValue?.fields?.lat?.doubleValue
    const loc = doc.fields?.location?.mapValue?.fields;
    if (loc && loc[fieldName]) {
      const v = loc[fieldName];
      if (v.doubleValue != null) return Number(v.doubleValue);
      if (v.integerValue != null) return Number(v.integerValue);
      if (v.stringValue != null && v.stringValue.trim() !== '') return Number(v.stringValue);
    }

    return null;
  };

  const readStringField = (doc: any, fieldName: string): string | null => {
    if (!doc) return null;
    const v1 = doc[fieldName];
    if (typeof v1 === 'string') return v1;
    // "native" nested location name
    if (fieldName === 'formattedAddress' && doc.location && typeof doc.location === 'object') {
      return doc.location.formattedAddress ?? doc.location.address ?? doc.location.name ?? null;
    }
    // Firestore REST JSON shape
    const f = doc.fields?.[fieldName];
    if (f?.stringValue != null) return String(f.stringValue);
    // nested mapValue.location
    const loc = doc.fields?.location?.mapValue?.fields;
    if (loc) {
      const cand = loc[fieldName];
      if (cand?.stringValue != null) return String(cand.stringValue);
      if (cand?.doubleValue != null) return String(cand.doubleValue);
    }
    return null;
  };

  const getDocId = (doc: any) => {
    if (!doc) return null;
    if (doc.id) return String(doc.id);
    if (doc._id) return String(doc._id);
    // REST: name = projects/.../documents/teams/{id}
    if (doc.name) return extractIdFromResourceName(String(doc.name));
    return null;
  };

  const firstLineOf = (text: string | undefined | null) => {
    if (!text) return '';
    // Split by newline first, then take first CSV-like segment before a comma for concise single-line display
    const byLine = String(text).split('\n').map(s => s.trim()).filter(Boolean);
    if (byLine.length === 0) return '';
    const first = byLine[0];
    // if address contains commas, take up to the first comma for a short address line
    const beforeComma = first.split(',').map(s => s.trim()).filter(Boolean)[0] ?? first;
    return beforeComma;
  };

  const searchNearbyGames = async () => {
    if (!userCoords) {
      Toast.show({ type: 'info', text1: 'Current location not available' });
      return;
    }
    setSearching(true);
    try {
      // Load games and teams (teams used to enrich teamName/homeColor/location)
      const [gamesSettled, teamsSettled] = await Promise.allSettled([
        listTopLevelCollection('games', 1000),
        listTopLevelCollection('teams', 1000),
      ]);

      const gamesRaw = gamesSettled.status === 'fulfilled' ? (gamesSettled.value as any[]) : [];
      const teamsRaw = teamsSettled.status === 'fulfilled' ? (teamsSettled.value as any[]) : [];

      // Debug logging to help if nothing shows up
      if (!Array.isArray(gamesRaw) || gamesRaw.length === 0) {
        console.debug('[FindGames] games list empty or not array:', gamesRaw);
      }
      if (!Array.isArray(teamsRaw) || teamsRaw.length === 0) {
        console.debug('[FindGames] teams list empty or not array:', teamsRaw);
      }

      // Build a map of teams by id for quick lookup (support multiple possible id keys)
      const teamsMap = new Map<string, any>();
      if (Array.isArray(teamsRaw)) {
        for (const t of teamsRaw) {
          const id = getDocId(t);
          if (id) teamsMap.set(id, t);
          // also try common field fallbacks
          if (t.teamId) teamsMap.set(String(t.teamId), t);
          if (t.id) teamsMap.set(String(t.id), t);
        }
      }

      const enriched = (Array.isArray(gamesRaw) ? gamesRaw : [])
        .map((g) => {
          // Try to extract lat/lng flexibly
          const latCandidates = [
            readNumberField(g, 'lat'),
            readNumberField(g, 'latitude'),
            readNumberField(g, 'locationLat'),
            // try nested object values:
            g?.location?.lat,
            g?.location?.latitude,
          ];
          const lngCandidates = [
            readNumberField(g, 'lng'),
            readNumberField(g, 'longitude'),
            readNumberField(g, 'locationLng'),
            g?.location?.lng,
            g?.location?.longitude,
          ];
          const lat = latCandidates.find((v) => v != null) ?? null;
          const lng = lngCandidates.find((v) => v != null) ?? null;
          if (lat == null || lng == null) {
            // If lat/lng not present, try to read from a "location" field that may contain an address only (skip)
            return null;
          }

          // compute km then convert to miles
          const dKm = haversineDistanceKm(userCoords.lat, userCoords.lng, Number(lat), Number(lng));
          const dMiles = dKm * KM_TO_MILES;

          // Determine teamId by trying several fields (teamId, team?.id, ownerTeam)
          const rawTeamId = g.teamId ?? g.team?.id ?? g.teamIdString ?? getDocId(g.team) ?? null;
          const teamDoc = rawTeamId ? teamsMap.get(String(rawTeamId)) : null;

          // teamName fallbacks (support REST nested string fields)
          const teamNameFromTeamDoc =
            teamDoc && (readStringField(teamDoc, 'teamName') ?? teamDoc.teamName ?? teamDoc.name ?? teamDoc.displayName);
          const teamName =
            teamNameFromTeamDoc ??
            readStringField(g, 'teamName') ??
            g.teamName ??
            g.team?.teamName ??
            String(rawTeamId ?? 'Unknown Team');

          // home color fallbacks
          const homeColor =
            (teamDoc && (readStringField(teamDoc, 'homeColor') ?? teamDoc.homeColor)) ??
            (g.team && (g.team.homeColor ?? readStringField(g.team, 'homeColor'))) ??
            g.homeColor ??
            g.teamHomeColor ??
            '#ffffff';

          // raw location fallback (team doc location or game doc location)
          const teamLocationRaw =
            (teamDoc && (readStringField(teamDoc, 'location') ?? readStringField(teamDoc, 'formattedAddress'))) ??
            readStringField(g, 'location') ??
            (g.location && (g.location.formattedAddress ?? g.location.address ?? g.location.name)) ??
            '';

          const locationFirst = firstLineOf(teamLocationRaw);

          return {
            // keep original shape for debugging
            ...g,
            id: g.id ?? getDocId(g) ?? g._id ?? `${teamName}-${lat}-${lng}`,
            distanceMiles: dMiles,
            teamName,
            teamHomeColor: homeColor,
            teamLocationFirstLine: locationFirst,
            teamId: rawTeamId ?? undefined,
          };
        })
        .filter(Boolean)
        .filter((g: any) => g.distanceMiles <= radiusMiles)
        .sort((a: any, b: any) => a.distanceMiles - b.distanceMiles);

      setResults(enriched);
    } catch (e: any) {
      console.warn('[FindGames] search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed', text2: e?.message ?? '' });
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const distanceLabel = (miles: number | null | undefined) => (miles == null ? '—' : `${miles.toFixed(1)} mi`);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={styles.header}>Find Games</Text>

      <View style={{ marginBottom: 12 }}>
        {loadingLocation ? (
          <ActivityIndicator />
        ) : (
          // per request, do not display raw coordinates; show only if not available
          null
        )}
        {!loadingLocation && !userCoords ? <Text style={{ color: '#666' }}>Location not available</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TextInput
          style={styles.input}
          value={String(radiusMiles)}
          keyboardType="numeric"
          onChangeText={(t) => {
            const n = Number(t);
            if (!Number.isFinite(n)) setRadiusMiles(0);
            else setRadiusMiles(Math.max(0, n));
          }}
        />
        <Text style={{ marginLeft: 8 }}>miles radius</Text>
        <View style={{ width: 12 }} />
        <Button title="Search" onPress={searchNearbyGames} disabled={searching || loadingLocation || !userCoords} />
      </View>

      {searching ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id ?? `${item.title ?? ''}-${item.distanceMiles}`)}
          renderItem={({ item }) => {
            const dt = item.startISO ? new Date(item.startISO) : null;
            const bg = item.teamHomeColor ?? '#ffffff';
            const textColor = getReadableTextColor(bg);
            return (
              <View style={[styles.card, { backgroundColor: bg }]}>
                <Text style={[{ fontWeight: '700', color: textColor }]}>{item.title ?? item.teamName ?? 'Game'}</Text>
                <Text style={{ color: textColor }}>{dt ? dt.toLocaleString() : 'TBA'}</Text>
                <Text style={{ color: textColor }}>Distance: {distanceLabel(item.distanceMiles)}</Text>
                <Text style={{ color: textColor }}>Team: {item.teamName}</Text>
                {item.teamLocationFirstLine ? <Text style={{ color: textColor }}>{item.teamLocationFirstLine}</Text> : null}
                <View style={{ height: 8 }} />
                <Button
                  title="View"
                  onPress={() =>
                    router.push(`/(tabs)/TeamDetailScreen?teamId=${encodeURIComponent(String(item.teamId ?? item.teamId))}`)
                  }
                  color="#0a7ea4"
                />
              </View>
            );
          }}
          ListEmptyComponent={() => (
            <View style={{ padding: 12 }}>
              <Text style={{ color: '#666' }}>No games found in the selected radius.</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

/**
 * Very small contrast helper: if background is dark return white text, else return black.
 * Accepts hex colors like "#rrggbb" or short "#rgb" and plain color names will default to black.
 */
function getReadableTextColor(bg: string) {
  try {
    if (!bg || typeof bg !== 'string') return '#000';
    // strip leading '#'
    let c = bg.trim();
    if (c[0] === '#') c = c.slice(1);
    if (c.length === 3) {
      c = c.split('').map((ch) => ch + ch).join('');
    }
    if (c.length !== 6) return '#000';
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    // luminance per ITU-R BT.709
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance < 140 ? '#fff' : '#000';
  } catch {
    return '#000';
  }
}

const styles = StyleSheet.create({
  header: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 8,
    borderRadius: 6,
    width: 90,
    backgroundColor: '#fff',
  },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    // backgroundColor overridden per-card by teamHomeColor
  },
});