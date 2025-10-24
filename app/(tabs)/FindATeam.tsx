import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { addDoc, collection } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { app, auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';
import { debugAuthState, getDocument, listTopLevelCollection, runCollectionQuery } from '../../src/firestoreRest';
import { geocodeAddress, haversineDistanceKm } from '../../src/locations';

// Team type includes rating (previously called ELO)
interface Team {
  id: string;
  teamName: string;
  location?: string;
  homeColor?: string;
  awayColor?: string;
  elo?: number; // numeric score stored in Firestore; UI label will show "Rating"
}

const KM_TO_MILES = 0.621371;
const DEFAULT_RADIUS_MILES = 15;

export default function FindATeam() {
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState<number>(DEFAULT_RADIUS_MILES);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sending, setSending] = useState(false);

  // Directory list (defaults shown when search empty)
  const [directory, setDirectory] = useState<Team[]>([]);
  const [dirLoading, setDirLoading] = useState(false);

  const user = auth.currentUser;
  const router = useRouter();

  // debounce ref
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    // load initial directory (top teams)
    fetchDirectory();
    // cleanup debounce on unmount
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    // Incremental search: debounce user input
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!searchTerm.trim()) {
        // show directory when empty
        setResults([]);
        return;
      }
      handleSearch(searchTerm.trim());
    }, 300) as unknown as number;
  }, [searchTerm]);

  useEffect(() => {
    (async () => {
      setLoadingLocation(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission not granted');
          setLoadingLocation(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e: any) {
        console.warn('[FindATeam] getCurrentPosition failed', e);
        setError(String(e?.message ?? e));
      } finally {
        setLoadingLocation(false);
      }
    })();
  }, []);

  const normalizeDocToTeam = (d: any): Team | null => {
    if (!d || !d.id) return null;
    return {
      id: String(d.id),
      teamName: String(d.teamName ?? ''),
      location: d.location ?? undefined,
      homeColor: d.homeColor ?? undefined,
      awayColor: d.awayColor ?? undefined,
      elo: d?.elo != null ? Number(d.elo) : undefined,
    };
  };

  const fetchDirectory = async () => {
    setDirLoading(true);
    try {
      await ensureFirestoreOnline();

      // diagnostic: log auth/token presence before query
      try {
        const dbg = await debugAuthState('FindATeam.fetchDirectory');
        console.log('[FindATeam] debugAuthState:', dbg);
      } catch (dbgErr) {
        console.warn('[FindATeam] debugAuthState failed', dbgErr);
      }

      // Use the REST-safe listing to get all teams (supports Expo/web fallback)
      const docs = await listTopLevelCollection('teams', 1000);
      const arr = Array.isArray(docs) ? (docs as any[]) : [];

      // Normalize a variety of document shapes (native SDK, web REST mapValue/fields, nested objects)
      const normalized: Team[] = arr
        .map((d: any) => {
          if (!d) return null;

          // id: support native id/_id or REST resource name
          let id = d.id ?? d._id ?? null;
          if (!id && typeof d.name === 'string') {
            const parts = d.name.split('/');
            id = parts[parts.length - 1] ?? null;
          }

          // teamName: try multiple places
          let teamName =
            d.teamName ??
            d.name ??
            (d.fields?.teamName?.stringValue) ??
            (d.team && (d.team.teamName ?? d.team.name)) ??
            null;

          // location: try native or REST nested location fields
          let location =
            d.location ??
            (d.fields?.location?.stringValue) ??
            (d.fields?.location?.mapValue?.fields?.formattedAddress?.stringValue) ??
            (d.fields?.location?.mapValue?.fields?.address?.stringValue) ??
            (d.location && (d.location.formattedAddress ?? d.location.address ?? d.location.name)) ??
            null;

          // colors & elo
          let homeColor =
            d.homeColor ??
            (d.fields?.homeColor?.stringValue) ??
            null;
          let awayColor =
            d.awayColor ??
            (d.fields?.awayColor?.stringValue) ??
            null;
          let elo =
            (d.elo != null ? Number(d.elo) : null) ??
            (d.fields?.elo?.integerValue ? Number(d.fields.elo.integerValue) : (d.fields?.elo?.doubleValue ? Number(d.fields.elo.doubleValue) : null));

          if (!id || !teamName) return null;

          return {
            id: String(id),
            teamName: String(teamName),
            location: location ?? undefined,
            homeColor: homeColor ?? undefined,
            awayColor: awayColor ?? undefined,
            elo: elo ?? undefined,
          } as Team;
        })
        .filter(Boolean) as Team[];

      // Sort alphabetically to make directory predictable
      normalized.sort((a, b) => (a.teamName ?? '').localeCompare(b.teamName ?? ''));

      setDirectory(normalized);
    } catch (e: any) {
      console.error('Failed to load directory', e);
      Toast.show({ type: 'error', text1: 'Failed to load teams', text2: e?.message ?? String(e) });
      setDirectory([]);
    } finally {
      setDirLoading(false);
    }
  };

  const handleSearch = async (term?: string) => {
    const qTerm = term ?? searchTerm;
    if (!qTerm.trim()) return;
    setSearching(true);
    setResults([]);
    setSelectedTeam(null);

    try {
      await ensureFirestoreOnline();

      const docs = await runCollectionQuery({
        collectionId: 'teams',
        // helper expects arrays for where/orderBy
        where: [{ fieldPath: 'teamName', op: 'GREATER_THAN_OR_EQUAL', value: qTerm }],
        orderBy: [{ fieldPath: 'teamName', direction: 'ASCENDING' }],
        limit: 50,
      });

      const teams = (docs as any[]).map((d: any) => normalizeDocToTeam(d)).filter(Boolean) as Team[];
      setResults(teams);

      if (teams.length === 0) {
        Toast.show({ type: 'info', text1: 'No teams found', text2: 'Try another name.' });
      }
    } catch (e: any) {
      console.error('❌ Error searching teams:', e);
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async () => {
    if (!selectedTeam) {
      Toast.show({ type: 'info', text1: 'Select a team first' });
      return;
    }
    if (!user) {
      router.replace('/(auth)/LoginScreen');
      return;
    }

    try {
      setSending(true);
      await ensureFirestoreOnline();

      // read user via REST helper (ensures user doc exists per your rules)
      const userDoc = await getDocument(`users/${user.uid}`);
      if (!userDoc) {
        Alert.alert('Error', 'User record not found.');
        return;
      }
      const userData = userDoc as any;
      if (userData.teamId) {
        Toast.show({
          type: 'error',
          text1: 'Already in a team',
          text2: 'You must leave your current team first.',
        });
        return;
      }

      // Try SDK write first (preferred)
      try {
        await addDoc(collection(db, 'requests'), {
          userId: user.uid,
          userEmail: user.email ?? '',
          teamId: selectedTeam.id,
          teamName: selectedTeam.teamName,
          requestedBy: user.uid,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });

        Toast.show({
          type: 'success',
          text1: 'Request sent!',
          text2: 'The team coordinator will review your request.',
        });

        router.replace('/(tabs)');
        return;
      } catch (sdkErr: any) {
        console.warn('[FindATeam] SDK addDoc failed, attempting REST fallback', sdkErr);
        // fall through to REST fallback below
      }

      // REST fallback: create document via Firestore REST API using caller ID token
      try {
        const projectId = (app as any)?.options?.projectId;
        const apiKey = (app as any)?.options?.apiKey;
        if (!projectId) throw new Error('Missing Firebase projectId (cannot use REST fallback)');

        // Build Firestore REST document body (simple string fields)
        const docBody: any = { fields: {} };
        const putString = (k: string, v: any) => {
          if (v === null || v === undefined) return;
          docBody.fields[k] = { stringValue: String(v) };
        };
        putString('userId', user.uid);
        putString('userEmail', user.email ?? '');
        putString('teamId', selectedTeam.id);
        putString('teamName', selectedTeam.teamName);
        putString('requestedBy', user.uid);
        putString('status', 'pending');
        putString('createdAt', new Date().toISOString());

        // Get fresh ID token if available
        let token: string | null = null;
        try {
          token = await (auth as any)?.currentUser?.getIdToken?.(true);
        } catch (tErr) {
          try {
            token = await (auth as any)?.currentUser?.getIdToken?.();
          } catch {
            token = null;
          }
        }

        const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/requests`;
        // Prefer auth header; fall back to apiKey query param (less secure but works for public write rules with key)
        const url = apiKey && !token ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(docBody) });
        const text = await res.text().catch(() => '<no body>');
        if (!res.ok) {
          console.warn('[FindATeam] REST create failed', { status: res.status, body: text });
          throw new Error(`REST create failed ${res.status}: ${text}`);
        }

        console.debug('[FindATeam] REST create response', text);

        Toast.show({
          type: 'success',
          text1: 'Request sent (fallback)',
          text2: 'The team coordinator will review your request.',
        });
        router.replace('/(tabs)');
        return;
      } catch (restErr: any) {
        console.error('[FindATeam] REST fallback failed', restErr);
        throw restErr;
      }
    } catch (e: any) {
      console.error('❌ Error sending request:', e);
      Toast.show({
        type: 'error',
        text1: 'Error sending request',
        text2: e.message || 'Something went wrong.',
      });
    } finally {
      setSending(false);
    }
  };

  const renderTeamCard = ({ item }: { item: Team }) => {
    const rating = Math.min(Math.max(item.elo ?? 1500, 800), 3000);
    return (
      <TouchableOpacity style={styles.teamCard} onPress={() => setSelectedTeam(item)}>
        <Text style={styles.teamName}>{item.teamName}</Text>
        {item.location ? <Text style={styles.teamLocation}>{item.location}</Text> : null}
        <Text style={styles.teamRating}>Rating: {rating}</Text>
      </TouchableOpacity>
    );
  };

  // Flexible extractors to handle native SDK docs and Firestore REST shapes
  const extractId = (doc: any) => {
    if (!doc) return null;
    if (doc.id) return String(doc.id);
    if (doc._id) return String(doc._id);
    if (doc.name && typeof doc.name === 'string') {
      const parts = doc.name.split('/');
      return parts[parts.length - 1];
    }
    return null;
  };

  const readNumber = (doc: any, ...keys: string[]) => {
    if (!doc) return null;
    // direct keys
    for (const k of keys) {
      const v = doc[k];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    }
    // fields.<key>.<doubleValue|integerValue|stringValue>
    if (doc.fields) {
      for (const k of keys) {
        const f = doc.fields[k];
        if (f) {
          if (f.doubleValue != null) return Number(f.doubleValue);
          if (f.integerValue != null) return Number(f.integerValue);
          if (f.stringValue != null && f.stringValue.trim() !== '') return Number(f.stringValue);
        }
      }
      // nested location mapValue
      const loc = doc.fields.location?.mapValue?.fields;
      if (loc) {
        for (const k of keys) {
          const f = loc[k];
          if (f) {
            if (f.doubleValue != null) return Number(f.doubleValue);
            if (f.integerValue != null) return Number(f.integerValue);
            if (f.stringValue != null && f.stringValue.trim() !== '') return Number(f.stringValue);
          }
        }
      }
    }
    // nested object like doc.location.lat
    if (doc.location && typeof doc.location === 'object') {
      for (const k of keys) {
        const v = (doc.location as any)[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      }
    }
    // fallback to nested team object coordinates
    if (doc.team && typeof doc.team === 'object') {
      for (const k of keys) {
        const v = (doc.team as any)[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
      }
    }
    return null;
  };

  const readString = (doc: any, key: string) => {
    if (!doc) return null;
    const v = doc[key];
    if (typeof v === 'string') return v;
    if (doc.fields?.[key]?.stringValue != null) return String(doc.fields[key].stringValue);
    // prefer formattedAddress in nested location
    if (key === 'location' && doc.location && typeof doc.location === 'object') {
      return doc.location.formattedAddress ?? doc.location.address ?? doc.location.name ?? null;
    }
    // nested fields.location.mapValue.fields...
    if (doc.fields?.location?.mapValue?.fields) {
      const locF = doc.fields.location.mapValue.fields;
      if (locF.formattedAddress?.stringValue) return locF.formattedAddress.stringValue;
      if (locF.address?.stringValue) return locF.address.stringValue;
      if (locF.name?.stringValue) return locF.name.stringValue;
    }
    return null;
  };

  const firstLineOf = (text: string | undefined | null) => {
    if (!text) return '';
    const byLine = String(text).split('\n').map(s => s.trim()).filter(Boolean);
    if (byLine.length === 0) return '';
    const first = byLine[0];
    const beforeComma = first.split(',').map(s => s.trim()).filter(Boolean)[0] ?? first;
    return beforeComma;
  };

  const loadTeams = async () => {
    setLoadingTeams(true);
    try {
      const docs = await listTopLevelCollection('teams', 1000);
      const arr = Array.isArray(docs) ? (docs as any[]) : [];
      setTeams(arr);
      return arr;
    } catch (e: any) {
      console.warn('[FindATeam] loadTeams failed', e);
      Toast.show({ type: 'error', text1: 'Failed to load teams', text2: e?.message ?? '' });
      setTeams([]);
      return [];
    } finally {
      setLoadingTeams(false);
    }
  };

  // Main search function: targetCoords is either user's coords or geocoded search coords
  const searchTeamsNearby = async (targetCoords?: { lat: number; lng: number }, useRadius = true) => {
    setSearching(true);
    try {
      const arr = teams.length ? teams : await loadTeams();

      if (!Array.isArray(arr) || arr.length === 0) {
        setResults([]);
        return;
      }

      // Build enriched list with distances
      const enriched = arr
        .map((t) => {
          const lat = readNumber(t, 'lat', 'latitude', 'locationLat') ?? null;
          const lng = readNumber(t, 'lng', 'longitude', 'locationLng') ?? null;

          // If not found, attempt nested structures
          const computedLat = lat ?? (t.latitude ?? t.location?.lat ?? null);
          const computedLng = lng ?? (t.longitude ?? t.location?.lng ?? null);

          // If still missing, try fields.location.mapValue.lat
          if (computedLat == null || computedLng == null) {
            // skip if no coords
            return {
              ...t,
              id: extractId(t) ?? t.id ?? t._id ?? null,
              distanceMiles: Number.POSITIVE_INFINITY,
              teamLocationFirstLine: firstLineOf(readString(t, 'location') ?? ''),
              teamName: (readString(t, 'teamName') ?? t.teamName ?? t.name) ?? 'Unknown Team',
              homeColor: (readString(t, 'homeColor') ?? t.homeColor) ?? '#ffffff',
            };
          }

          const target = targetCoords ?? userCoords;
          const distanceKm = target ? haversineDistanceKm(target.lat, target.lng, Number(computedLat), Number(computedLng)) : Number.POSITIVE_INFINITY;
          const distanceMiles = distanceKm * KM_TO_MILES;

          return {
            ...t,
            id: extractId(t) ?? t.id ?? t._id ?? null,
            latitude: Number(computedLat),
            longitude: Number(computedLng),
            distanceMiles,
            teamLocationFirstLine: firstLineOf(readString(t, 'location') ?? ''),
            teamName: (readString(t, 'teamName') ?? t.teamName ?? t.name) ?? 'Unknown Team',
            homeColor: (readString(t, 'homeColor') ?? t.homeColor) ?? '#ffffff',
          };
        })
        .filter(Boolean);

      // Filter by radius if requested and we have a target; otherwise just sort
      let withinRadius = useRadius && targetCoords != null;
      let candidates = withinRadius ? enriched.filter((x) => x.distanceMiles != null && x.distanceMiles <= radiusMiles) : enriched;

      // If no results within radius and we used a search term, fall back to closest to the search coords
      if ((!Array.isArray(candidates) || candidates.length === 0) && targetCoords != null) {
        // Show the 20 closest teams to the search coords
        candidates = enriched.filter((x) => x.distanceMiles != null).sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, 20);
        Toast.show({ type: 'info', text1: 'No teams inside radius — showing closest teams to search area' });
      }

      // If still no results and we have user coords, show closest teams to user (best effort)
      if ((!Array.isArray(candidates) || candidates.length === 0) && userCoords) {
        const fallback = enriched.filter((x) => x.distanceMiles != null && isFinite(x.distanceMiles)).sort((a, b) => a.distanceMiles - b.distanceMiles).slice(0, 50);
        candidates = fallback;
        if (fallback.length > 0) {
          Toast.show({ type: 'info', text1: 'No teams found in area — showing teams closest to you' });
        }
      }

      // Final sorting: always closest-first
      const final = (Array.isArray(candidates) ? candidates : enriched).sort((a, b) => {
        const A = isFinite(a.distanceMiles) ? a.distanceMiles : Number.POSITIVE_INFINITY;
        const B = isFinite(b.distanceMiles) ? b.distanceMiles : Number.POSITIVE_INFINITY;
        return A - B;
      });

      setResults(final);
    } catch (e: any) {
      console.warn('[FindATeam] search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed', text2: e?.message ?? '' });
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Handler for "Search Area" (searchTerm -> geocode -> searchTeamsNearby)
  const handleSearchArea = async () => {
    if (!searchTerm || searchTerm.trim() === '') {
      // no search term — just search near user
      if (!userCoords) {
        Toast.show({ type: 'info', text1: 'No location available', text2: 'Allow location permissions or enter a search area.' });
        return;
      }
      await searchTeamsNearby(userCoords, true);
      return;
    }

    setSearching(true);
    try {
      // Ensure we have an API key available (geocode helper uses Constants/expo config)
      const key = Constants.expoConfig?.extra?.googleMapsApiKey ?? (process.env.GOOGLE_MAPS_API_KEY as string);
      if (!key) {
        Toast.show({ type: 'error', text1: 'Search unavailable', text2: 'No Google Maps API key configured.' });
        setSearching(false);
        return;
      }

      const geo = await geocodeAddress(searchTerm);
      console.debug('[FindATeam] geocode result for "%s":', searchTerm, geo);

      // PlaceDetails type has optional lat/lng and formattedAddress/name
      const maybeLat = geo?.lat ?? null;
      const maybeLng = geo?.lng ?? null;
      const hasCoords = maybeLat != null && maybeLng != null && !Number.isNaN(Number(maybeLat)) && !Number.isNaN(Number(maybeLng));
      const hasAddress = !!(geo?.formattedAddress || geo?.name || geo?.placeId);

      if (!geo || (!hasCoords && !hasAddress)) {
        Toast.show({ type: 'info', text1: 'No location found for search' });
        // fallback to search near user if available
        if (userCoords) await searchTeamsNearby(userCoords, true);
        setSearching(false);
        return;
      }

      if (hasCoords) {
        const target = { lat: Number(maybeLat), lng: Number(maybeLng) };
        await searchTeamsNearby(target, true);
      } else {
        // We have an address/place but no direct coords — fall back to user or broad search
        if (userCoords) {
          Toast.show({ type: 'info', text1: 'Searching near your location' });
          await searchTeamsNearby(userCoords, true);
        } else {
          // broad search without radius (sorts by name/distance fallback)
          await searchTeamsNearby(undefined, false);
        }
      }
    } catch (e: any) {
      console.warn('[FindATeam] geocode failed', e);
      Toast.show({ type: 'error', text1: 'Geocode failed', text2: e?.message ?? '' });
    } finally {
      setSearching(false);
    }
  };

  // Quick "Find nearest teams to me" action
  const handleNearestToMe = async () => {
    if (!userCoords) {
      Toast.show({ type: 'info', text1: 'No location available', text2: 'Allow location permissions to enable nearest search.' });
      return;
    }
    await searchTeamsNearby(userCoords, true);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Find a Team</Text>

      <View style={{ marginBottom: 12 }}>
        {loadingLocation ? <ActivityIndicator /> : null}
        {!loadingLocation && !userCoords ? <Text style={{ color: '#666' }}>Location not available</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TextInput
          style={styles.input}
          placeholder="Search area (city, rink, suburb)..."
          value={searchTerm}
          onChangeText={setSearchTerm}
        />
        <View style={{ width: 8 }} />
        <Button title="Search Area" onPress={handleSearchArea} disabled={searching || loadingTeams} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TextInput
          style={[styles.input, { width: 100 }]}
          value={String(radiusMiles)}
          keyboardType="numeric"
          onChangeText={(t) => {
            const n = Number(t);
            if (!Number.isFinite(n)) setRadiusMiles(DEFAULT_RADIUS_MILES);
            else setRadiusMiles(Math.max(0, n));
          }}
        />
        <Text style={{ marginLeft: 8 }}>miles radius</Text>
        <View style={{ width: 12 }} />
        <Button title="Nearest to me" onPress={handleNearestToMe} disabled={loadingLocation || loadingTeams} />
        <View style={{ width: 8 }} />
        <Button title="Refresh Teams" onPress={() => loadTeams().then(() => searchTeamsNearby(userCoords ?? undefined, true))} disabled={loadingTeams} />
      </View>

      {/* Preview results when searching */}
      {searching && <ActivityIndicator size="small" color="#0a7ea4" style={{ marginTop: 12 }} />}

      {results.length > 0 && !selectedTeam ? (
        <View style={{ marginTop: 12, width: '100%' }}>
          <Text style={styles.sectionTitle}>Search results</Text>
          <FlatList
            data={results}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderTeamCard}
            scrollEnabled={false}
          />
        </View>
      ) : null}

      {/* Directory fallback when no search term */}
      {!searchTerm.trim() && (
        <View style={{ marginTop: 12, width: '100%' }}>
          <Text style={styles.sectionTitle}>Team directory</Text>
          {dirLoading ? (
            <ActivityIndicator size="small" color="#0a7ea4" style={{ marginTop: 12 }} />
          ) : directory.length === 0 ? (
            <Text style={{ color: '#666' }}>No teams available</Text>
          ) : (
            <FlatList
              data={directory}
              keyExtractor={(i) => String(i.id)}
              renderItem={renderTeamCard}
              scrollEnabled={false}
            />
          )}
        </View>
      )}

      {/* Selected team preview & request button */}
      {selectedTeam && (
        <View style={styles.selectedContainer}>
          <Text style={styles.selectedTitle}>Selected Team</Text>
          <Text style={styles.teamName}>{selectedTeam.teamName}</Text>
          {selectedTeam.location && <Text style={styles.teamLocation}>{selectedTeam.location}</Text>}
          <Text style={{ marginTop: 6 }}>Rating: {Math.min(Math.max(selectedTeam.elo ?? 1500, 800), 3000)}</Text>

          <View style={{ marginTop: 15 }}>
            <Button
              title={sending ? 'Sending...' : 'Request to Join'}
              onPress={handleSendRequest}
              disabled={sending}
              color="#0a7ea4"
            />
          </View>

          <View style={{ marginTop: 10 }}>
            <Button title="Cancel" onPress={() => setSelectedTeam(null)} color="#FF3B30" />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0a7ea4', marginBottom: 8 },
  searchSection: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
  teamCard: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#f9f9f9',
  },
  teamName: { fontSize: 18, fontWeight: 'bold', color: '#0a7ea4' },
  teamLocation: { fontSize: 14, color: '#666' },
  teamRating: { marginTop: 6, fontSize: 14, color: '#333', fontWeight: '600' },
  selectedContainer: { marginTop: 20 },
  selectedTitle: { fontSize: 20, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
});