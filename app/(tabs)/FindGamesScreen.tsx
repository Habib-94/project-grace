import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { addDoc, collection } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { app, auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';
import { debugAuthState, getDocument, listTopLevelCollection } from '../../src/firestoreRest';
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

  // keep loaded teams around so we can display metadata in the modal
  const [teams, setTeams] = useState<any[]>([]);
  // modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<any | null>(null);
  const [modalTeamDoc, setModalTeamDoc] = useState<any | null>(null);
  // creator user doc for the game (to show full name)
  const [modalCreatorDoc, setModalCreatorDoc] = useState<any | null>(null);
  const [requesting, setRequesting] = useState(false);

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

  // Helpers to cope with native SDK shapes and Firestore REST shapes
  const extractIdFromResourceName = (name?: string) => {
    if (!name) return null;
    const parts = name.split('/');
    return parts[parts.length - 1] || null;
  };

  const readNumberField = (doc: any, fieldName: string): number | null => {
    if (!doc) return null;
    const v1 = doc[fieldName];
    if (typeof v1 === 'number') return v1;
    if (typeof v1 === 'string' && v1.trim() !== '' && !Number.isNaN(Number(v1))) return Number(v1);
    if (doc.location && typeof doc.location === 'object') {
      const lat = fieldName === 'lat' ? doc.location.lat ?? doc.location.latitude : undefined;
      if (typeof lat === 'number') return lat;
    }
    const f = doc.fields?.[fieldName];
    if (f) {
      if (f.doubleValue != null) return Number(f.doubleValue);
      if (f.integerValue != null) return Number(f.integerValue);
      if (f.stringValue != null && f.stringValue.trim() !== '') return Number(f.stringValue);
    }
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
    if (fieldName === 'formattedAddress' && doc.location && typeof doc.location === 'object') {
      return doc.location.formattedAddress ?? doc.location.address ?? doc.location.name ?? null;
    }
    const f = doc.fields?.[fieldName];
    if (f?.stringValue != null) return String(f.stringValue);
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
    if (doc.name) return extractIdFromResourceName(String(doc.name));
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

  const searchNearbyGames = async () => {
    if (!userCoords) {
      Toast.show({ type: 'info', text1: 'Current location not available' });
      return;
    }

    // Require an authenticated user because your Firestore rules require auth for reads.
    const currentUser = auth?.currentUser ?? null;
    if (!currentUser) {
      Toast.show({ type: 'info', text1: 'Sign in required', text2: 'Please sign in to search games.' });
      router.push('/(auth)/LoginScreen');
      return;
    }

    setSearching(true);
    try {
      let gamesRaw: any[] = [];
      let teamsRaw: any[] = [];

      // Prefer SDK reads when the native SDK (db) is available.
      if (db && typeof (db as any).collection === 'function') {
        try {
          const gSnap = await (db as any).collection('games').get();
          gamesRaw = (gSnap?.docs ?? []).map((d: any) => ({ id: d.id, ...(d.data?.() ?? d.data ?? {}) }));
        } catch (sdkGErr) {
          console.warn('[FindGames] SDK games collection read failed', sdkGErr);
          gamesRaw = [];
        }

        try {
          const tSnap = await (db as any).collection('teams').get();
          teamsRaw = (tSnap?.docs ?? []).map((d: any) => ({ id: d.id, ...(d.data?.() ?? d.data ?? {}) }));
        } catch (sdkTErr) {
          console.warn('[FindGames] SDK teams collection read failed', sdkTErr);
          teamsRaw = [];
        }
      } else {
        // Fallback to REST helper. If REST fails with 403 it's likely missing auth token or rules block.
        const [gamesSettled, teamsSettled] = await Promise.allSettled([
          listTopLevelCollection('games', 1000),
          listTopLevelCollection('teams', 1000),
        ]);

        if (gamesSettled.status === 'fulfilled') gamesRaw = gamesSettled.value as any[];
        else {
          console.warn('[FindGames] listTopLevelCollection(games) failed', gamesSettled.reason);
          if (String(gamesSettled.reason).toLowerCase().includes('permission')) {
            Toast.show({ type: 'error', text1: 'Permission denied', text2: 'Sign in or check Firestore rules.' });
          }
        }

        if (teamsSettled.status === 'fulfilled') teamsRaw = teamsSettled.value as any[];
        else {
          console.warn('[FindGames] listTopLevelCollection(teams) failed', teamsSettled.reason);
        }
      }

      // persist teams for modal use
      if (Array.isArray(teamsRaw)) setTeams(teamsRaw);

      const teamsMap = new Map<string, any>();
      if (Array.isArray(teamsRaw)) {
        for (const t of teamsRaw) {
          const id = getDocId(t);
          if (id) teamsMap.set(id, t);
          if ((t as any).teamId) teamsMap.set(String((t as any).teamId), t);
          if ((t as any).id) teamsMap.set(String((t as any).id), t);
        }
      }

      const enriched = (Array.isArray(gamesRaw) ? gamesRaw : [])
        .map((g) => {
          const latCandidates = [
            readNumberField(g, 'lat'),
            readNumberField(g, 'latitude'),
            readNumberField(g, 'locationLat'),
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
          if (lat == null || lng == null) return null;

          const dKm = haversineDistanceKm(userCoords.lat, userCoords.lng, Number(lat), Number(lng));
          const dMiles = dKm * KM_TO_MILES;

          const rawTeamId = g.teamId ?? g.team?.id ?? g.teamIdString ?? getDocId(g.team) ?? null;
          const teamDoc = rawTeamId ? teamsMap.get(String(rawTeamId)) : null;

          const teamNameFromTeamDoc =
            teamDoc && (readStringField(teamDoc, 'teamName') ?? teamDoc.teamName ?? teamDoc.name ?? teamDoc.displayName);
          const teamName =
            teamNameFromTeamDoc ?? readStringField(g, 'teamName') ?? g.teamName ?? g.team?.teamName ?? String(rawTeamId ?? 'Unknown Team');

          const homeColor =
            (teamDoc && (readStringField(teamDoc, 'homeColor') ?? teamDoc.homeColor)) ??
            (g.team && (g.team.homeColor ?? readStringField(g.team, 'homeColor'))) ??
            g.homeColor ??
            g.teamHomeColor ??
            '#ffffff';

          const teamLocationRaw =
            (teamDoc && (readStringField(teamDoc, 'location') ?? readStringField(teamDoc, 'formattedAddress'))) ??
            readStringField(g, 'location') ??
            (g.location && (g.location.formattedAddress ?? g.location.address ?? g.location.name)) ??
            '';

          const locationFirst = firstLineOf(teamLocationRaw);

          // NEW: prefer denormalized rating on game, then game's elo, then team doc's rating/elo
          const teamRating = (typeof g.teamRating !== 'undefined' && g.teamRating !== null)
            ? g.teamRating
            : (typeof g.elo !== 'undefined' && g.elo !== null)
            ? g.elo
            : (teamDoc?.elo ?? teamDoc?.rating ?? null);

          // NEW: prefer denormalized creator name fields
          const createdByName = g.createdByName ?? g.coordinatorName ?? g.createdByDisplayName ?? null;

          return {
            ...g,
            id: g.id ?? getDocId(g) ?? g._id ?? `${teamName}-${lat}-${lng}`,
            distanceMiles: dMiles,
            teamName,
            teamHomeColor: homeColor,
            teamLocationFirstLine: locationFirst,
            teamId: rawTeamId ?? undefined,
            // denormalized extras we just computed:
            teamRating,
            createdByName,
          };
        })
        .filter(Boolean)
        .filter((g: any) => g.distanceMiles <= radiusMiles)
        .sort((a: any, b: any) => a.distanceMiles - b.distanceMiles);

      // filter out expired/past games (use expiresAt if present, else startISO + 5min grace)
      const nowMs = Date.now();
      const enrichedFiltered = enriched.filter((g: any) => {
        // prefer expiresAt if present (ISO string)
        if (g.expiresAt) {
          const t = new Date(g.expiresAt).getTime();
          if (!isNaN(t)) return t > nowMs;
          return true;
        }
        // fallback to startISO (expire at start time)
        if (g.startISO) {
          const t = new Date(g.startISO).getTime();
          return !isNaN(t) ? t > nowMs : true;
        }
        return true; // keep TBA items
      });

      setResults(enrichedFiltered);
    } catch (e: any) {
      console.warn('[FindGames] search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed', text2: e?.message ?? '' });
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const distanceLabel = (miles: number | null | undefined) => (miles == null ? '—' : `${miles.toFixed(1)} mi`);

  // open modal and ensure we have the team document for the selected game
  const openGameModal = async (game: any) => {
    setSelectedGame(game);
    setModalTeamDoc(null);
    setModalCreatorDoc(null);
    setModalVisible(true);

    // try to find team doc from cached teams first (unchanged)
    const teamId = game.teamId ?? game.teamIdString ?? null;
    if (teamId) {
      const cached = teams.find((t) =>
        getDocId(t) === String(teamId) ||
        String(t.id) === String(teamId) ||
        String(t.teamId) === String(teamId)
      );
      if (cached) {
        setModalTeamDoc(cached);
      } else {
        try {
          await ensureFirestoreOnline();
          const t = await getDocument(`teams/${String(teamId)}`);
          if (t) setModalTeamDoc(t);
        } catch (err) {
          // best-effort: ignore failures, keep denormalized fallback from the game doc
          console.warn('[FindGames] failed to load team doc for modal (best-effort)', err);
        }
      }
    }

    // IMPORTANT: do NOT attempt to read users/{creatorUid} here.
    // That read will be denied by rules for other users and produces the permission warning.
    // Instead, prefer denormalized creator fields that should be written into the game document on create.
    // Use the game doc's denormalized fields if present; otherwise fall back to a minimal placeholder.

    const creatorFallback = {
      displayName: game.createdByName ?? game.createdByDisplayName ?? game.coordinatorName ?? 'Private user',
      email: game.createdByEmail ?? null,
      rating: typeof game.createdByRating !== 'undefined' ? game.createdByRating : (typeof game.createdByRating === 'undefined' ? null : game.createdByRating),
    };

    setModalCreatorDoc({
      displayName: creatorFallback.displayName,
      email: creatorFallback.email,
      rating: creatorFallback.rating,
    });

    // NOTE: we intentionally do NOT call getDocument(`users/${creatorUid}`) anymore.
    // If you still want an optional enrichment for cases where the viewer is the creator or
    // you have a publicProfiles collection, we can fetch only when allowed (or when the current user === creator).
  };

  // small helper to convert JS value -> Firestore REST field value object
  const makeRestFieldValue = (v: any): any | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return { stringValue: String(v) };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return { integerValue: `${v}` };
      return { doubleValue: v };
    }
    if (Array.isArray(v)) {
      const values = v.map((x) => makeRestFieldValue(x)).filter((x) => x != null);
      if (values.length === 0) return null;
      return { arrayValue: { values } };
    }
    if (typeof v === 'object') {
      const fields: any = {};
      for (const k of Object.keys(v)) {
        const fv = makeRestFieldValue((v as any)[k]);
        if (fv != null) fields[k] = fv;
      }
      if (Object.keys(fields).length === 0) return null;
      return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
  };

  // request a game as the caller's team
  const requestGame = async () => {
    if (!selectedGame) return;
    const user = auth?.currentUser ?? null;
    if (!user) {
      Toast.show({ type: 'info', text1: 'Please sign in', text2: 'You must be signed in to request a game' });
      router.push('/(auth)/LoginScreen');
      return;
    }

    setRequesting(true);
    try {
      await ensureFirestoreOnline();

      // load caller user doc to discover their teamId and teamName
      const me = await getDocument(`users/${user.uid}`);
      if (!me) {
        Toast.show({ type: 'error', text1: 'User record not found' });
        return;
      }
      if (me.teamId == null) {
        Toast.show({ type: 'info', text1: 'Join or create a team first', text2: 'You need a team to request a game.' });
        return;
      }

      // Build request payload
      // NOTE: preserve the original type of me.teamId (do NOT coerce to string)
      const requestingTeamId = me.teamId;
      const requestingTeamName = me.teamName ?? me.displayName ?? '';
      const homeTeamId = selectedGame.teamId ?? selectedGame.teamIdString ?? null;

      const payload: any = {
        // Make the request document target the home team so their coordinator receives it
        teamId: homeTeamId,                // <-- CRITICAL: coordinator dashboard expects 'teamId'
        requestingTeamId,
        requestingTeamName,
        homeTeamId,
        homeTeamName: selectedGame.teamName ?? '',
        gameId: selectedGame.id ?? null,
        title: selectedGame.title ?? `${selectedGame.teamName ?? 'Home Team'} game request`,
        startISO: selectedGame.startISO ?? null,
        status: 'pending',
        createdAt: new Date().toISOString(),

        // include UID fields so rules that check ownership can pass
        requestedBy: user.uid,
        createdBy: user.uid,

        // include denormalized requester coordinator info so home coordinator sees team + coordinator + rating
        requestingCoordinatorName: me.displayName ?? me.fullName ?? me.name ?? '',
        requestingCoordinatorEmail: me.email ?? null,
        requestingCoordinatorRating: typeof me.rating !== 'undefined' ? me.rating : null,
      };

      // ====== diagnostic: print token/payload so we can see why rules denied ======
      try {
        await debugAuthState?.('FindGames.requestGame-before-write');
      } catch (dbgErr) {
        console.warn('[FindGames] debugAuthState failed', dbgErr);
      }

      // SDK-first write (preferred)
      try {
        await addDoc(collection(db, 'gameRequests'), payload);
        Toast.show({ type: 'success', text1: 'Game request sent', text2: 'The home team coordinator will review it.' });
        setModalVisible(false);
        setSelectedGame(null);
        return;
      } catch (sdkErr: any) {
        console.warn('[FindGames] SDK addDoc gameRequests failed', sdkErr);
        // fallthrough -> try REST fallback below
      }

      // REST fallback: create document via Firestore REST API using caller ID token
      try {
        const projectId = (app as any)?.options?.projectId;
        const apiKey = (app as any)?.options?.apiKey;
        if (!projectId) throw new Error('Missing Firebase projectId (cannot use REST fallback)');

        const docBody: any = { fields: {} };
        const put = (k: string, v: any) => {
          const fv = makeRestFieldValue(v);
          if (fv != null) docBody.fields[k] = fv;
        };

        put('requestingTeamId', payload.requestingTeamId);
        put('requestingTeamName', payload.requestingTeamName);
        put('homeTeamId', payload.homeTeamId);
        put('homeTeamName', payload.homeTeamName);
        put('gameId', payload.gameId);
        put('title', payload.title);
        put('startISO', payload.startISO);
        put('status', payload.status);
        put('createdAt', payload.createdAt);
        put('requestedBy', payload.requestedBy);
        put('createdBy', payload.createdBy);
        put('teamId', payload.teamId);
        put('requestingCoordinatorName', payload.requestingCoordinatorName);
        put('requestingCoordinatorEmail', payload.requestingCoordinatorEmail);
        put('requestingCoordinatorRating', payload.requestingCoordinatorRating);

        // Get fresh ID token if available
        let token: string | null = null;
        try {
          token = await (auth as any)?.currentUser?.getIdToken?.(true);
        } catch {
          try {
            token = await (auth as any)?.currentUser?.getIdToken?.();
          } catch {
            token = null;
          }
        }

        const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/gameRequests`;
        const url = apiKey && !token ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(docBody) });
        const text = await res.text().catch(() => '<no body>');
        if (!res.ok) {
          console.warn('[FindGames] REST create failed', { status: res.status, body: text });
          throw new Error(`REST create failed ${res.status}: ${text}`);
        }

        console.debug('[FindGames] REST create response', text);
        Toast.show({ type: 'success', text1: 'Game request sent (fallback)', text2: 'The home team coordinator will review it.' });
        setModalVisible(false);
        setSelectedGame(null);
        return;
      } catch (restErr: any) {
        console.error('[FindGames] REST fallback failed', restErr);
        throw restErr; // upper catch will show the toast error
      }
    } catch (err: any) {
      console.error('[FindGames] requestGame failed', err);
      Toast.show({ type: 'error', text1: 'Failed to send request', text2: err?.message ?? String(err) });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={styles.header}>Find Games</Text>

      <View style={{ marginBottom: 12 }}>
        {loadingLocation ? (
          <ActivityIndicator />
        ) : null}
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
        <Button
          title="Search"
          onPress={searchNearbyGames}
          disabled={searching || loadingLocation || !userCoords}
          color="#ff3b30" // red
        />
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
                  onPress={() => openGameModal(item)}
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

      {/* Game details modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 16, maxHeight: '90%' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
              {selectedGame?.title ?? selectedGame?.teamName ?? 'Game details'}
            </Text>

            <Text style={{ color: '#333', marginBottom: 4 }}>
              When: {selectedGame?.startISO ? new Date(selectedGame.startISO).toLocaleString() : 'TBA'}
            </Text>

            <Text style={{ color: '#333', marginBottom: 4 }}>
              Where: {selectedGame?.teamLocationFirstLine ?? (modalTeamDoc ? firstLineOf(readStringField(modalTeamDoc, 'location') ?? '') : 'Unknown')}
            </Text>

            {/* Show home team name */}
            <Text style={{ color: '#333', marginTop: 4 }}>
              Team: {modalTeamDoc?.teamName ?? selectedGame?.teamName ?? 'Unknown'}
            </Text>

            {/* Kit colors */}
            <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'center' }}>
              <View
                style={{
                  width: 16,
                  height: 16,
                  backgroundColor: modalTeamDoc?.homeColor ?? selectedGame?.teamHomeColor ?? selectedGame?.homeColor ?? '#fff',
                  borderWidth: 1,
                  borderColor: '#ddd',
                  marginRight: 8,
                }}
              />
              <Text style={{ color: '#333' }}>Home kit</Text>
              <View style={{ width: 12 }} />
              <View
                style={{
                  width: 16,
                  height: 16,
                  backgroundColor: modalTeamDoc?.awayColor ?? selectedGame?.awayColor ?? '#fff',
                  borderWidth: 1,
                  borderColor: '#ddd',
                  marginRight: 8,
                }}
              />
              <Text style={{ color: '#333' }}>Away kit</Text>
            </View>

            {/* Team Rating: prefer denormalized fields on the game, then team doc */}
            <Text style={{ color: '#333', marginTop: 8 }}>
              Team Rating: { (selectedGame?.teamRating ?? selectedGame?.elo ?? modalTeamDoc?.elo ?? modalTeamDoc?.rating) ?? '—' }
            </Text>

            {/* Coordinator (creator) name: prefer denormalized fields on the game first */}
            <Text style={{ color: '#333', marginTop: 8, marginBottom: 12 }}>
              Coordinator: {(selectedGame?.createdByName ?? selectedGame?.coordinatorName ?? modalCreatorDoc?.displayName ?? modalTeamDoc?.coordinatorName ?? 'Unknown')}
            </Text>

            {/* Action buttons */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
              <Pressable
                onPress={() => { setModalVisible(false); setSelectedGame(null); }}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#eee' }}
              >
                <Text style={{ color: '#333' }}>Close</Text>
              </Pressable>

              <Pressable onPress={requestGame} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#0a7ea4' }} disabled={requesting}>
                <Text style={{ color: '#fff' }}>{requesting ? 'Sending...' : 'Request Game'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Very small contrast helper: if background is dark return white text, else return black.
 * Accepts hex colors like "#rrggbb" or short "#rgb" and plain color names will default to black.
 */
function getReadableTextColor(bg?: string) {
  try {
    if (!bg || typeof bg !== 'string') return '#000';
    let c = bg.trim();
    if (c[0] === '#') c = c.slice(1);
    if (c.length === 3) {
      c = c.split('').map((ch) => ch + ch).join('');
    }
    if (c.length !== 6) return '#000';
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
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
  },
});