import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

import { emitAppEvent } from '../../src/appEvents';
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';
import { getDocument } from '../../src/firestoreRest';
import { geocodeAddress, getPlaceDetails } from '../../src/locations';

// runtime-safe add/update helpers (same pattern as elsewhere)
async function addDocSafe(collectionPath: string, data: any) {
  // Native RN Firebase style
  if (db && typeof (db as any).collection === 'function') {
    return (db as any).collection(collectionPath).add(data);
  }

  // Web modular SDK
  const { collection, addDoc } = await import('firebase/firestore');
  return addDoc(collection(db as any, collectionPath), data);
}

// runtime-safe upsert/set with merge
async function upsertUserDoc(uid: string, data: any) {
  // Native RN Firebase style
  try {
    if (db && typeof (db as any).collection === 'function') {
      // native firestore supports .doc(uid).set(data, { merge: true })
      return await (db as any).collection('users').doc(uid).set(data, { merge: true });
    }
  } catch (e) {
    // fallthrough to web
  }

  // Web modular SDK
  const { doc, setDoc } = await import('firebase/firestore');
  return setDoc(doc(db as any, 'users', uid), data, { merge: true });
}

type Prediction = {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
};

export default function CreateTeamScreen() {
  const router = useRouter();
  const user = auth?.currentUser ?? null;

  // Stable initial states (avoid undefined issues)
  const [teamName, setTeamName] = useState('');
  const [locationText, setLocationText] = useState('');
  const [pickedPlace, setPickedPlace] = useState<{
    placeId?: string;
    name?: string;
    formattedAddress?: string;
    lat?: number;
    lng?: number;
  } | null>(null);
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [loading, setLoading] = useState(false);

  // Autocomplete state
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const acAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<any>(null);

  // derive API key (same source as src/locations.ts)
  const API_KEY =
    (Constants.expoConfig?.extra?.googleMapsApiKey as string) ??
    (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string) ??
    (process.env.GOOGLE_MAPS_API_KEY as string) ??
    '';

  // Debounced autocomplete: fetch predictions when typing
  useEffect(() => {
    // If user already picked a place that matches the text, don't show predictions
    if (!locationText || pickedPlace?.formattedAddress === locationText || pickedPlace?.name === locationText) {
      setPredictions([]);
      setLoadingPredictions(false);
      return;
    }

    // clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // small debounce so we don't hit quota while user types
    debounceRef.current = setTimeout(() => {
      fetchPredictions(locationText);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (acAbortRef.current) {
        try { acAbortRef.current.abort(); } catch {}
        acAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationText]);

  async function fetchPredictions(input: string) {
    setLoadingPredictions(true);
    setPredictions([]);
    if (!API_KEY || !input || input.trim().length < 2) {
      setLoadingPredictions(false);
      return;
    }

    // Abort previous request if any
    if (acAbortRef.current) {
      try { acAbortRef.current.abort(); } catch {}
      acAbortRef.current = null;
    }
    const ac = new AbortController();
    acAbortRef.current = ac;

    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        input
      )}&types=establishment&language=en&key=${API_KEY}`;

      const res = await fetch(url, { signal: ac.signal });
      const json = await res.json();
      if (json?.status === 'OK' && Array.isArray(json.predictions)) {
        setPredictions(json.predictions.slice(0, 6));
      } else {
        setPredictions([]);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // ignore
      } else {
        console.warn('[CreateTeam] autocomplete fetch failed', e);
      }
      setPredictions([]);
    } finally {
      setLoadingPredictions(false);
      acAbortRef.current = null;
    }
  }

  // When user picks a prediction, fetch details and set pickedPlace
  const handleSelectPrediction = async (p: Prediction) => {
    setLoading(true);
    try {
      const details = await getPlaceDetails(p.place_id);
      if (!details) {
        setLocationText(p.description);
        setPickedPlace(null);
        Toast.show({ type: 'info', text1: 'Selected place', text2: p.description });
      } else {
        setPickedPlace(details);
        const display = details.formattedAddress ?? details.name ?? p.description;
        setLocationText(display);
        Toast.show({ type: 'success', text1: 'Location selected', text2: display });
      }
      setPredictions([]);
    } catch (e: any) {
      console.warn('[CreateTeam] select prediction failed', e);
      Toast.show({ type: 'error', text1: 'Lookup failed', text2: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleLookupPlace = async () => {
    if (!locationText || locationText.trim().length < 3) {
      Toast.show({ type: 'info', text1: 'Enter an address or rink name first' });
      return;
    }
    setLoading(true);
    try {
      const res = await geocodeAddress(locationText.trim());
      if (!res) {
        Toast.show({ type: 'error', text1: 'No results', text2: 'Google did not return a match.' });
        setPickedPlace(null);
      } else {
        setPickedPlace(res);
        setLocationText(res.formattedAddress ?? res.name ?? locationText.trim());
        Toast.show({ type: 'success', text1: 'Location found', text2: res.formattedAddress ?? res.name });
        setPredictions([]);
      }
    } catch (e: any) {
      console.warn('[CreateTeam] geocodeAddress failed', e);
      Toast.show({ type: 'error', text1: 'Lookup failed', text2: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  // Rewritten handler with validation and clear error messages
  const handleCreateTeam = async () => {
    if (!user) {
      Toast.show({ type: 'error', text1: 'Sign in required', text2: 'You must sign in to create a team.' });
      router.replace('/(auth)/LoginScreen');
      return;
    }

    // Basic client-side validation for required details
    if (!teamName || !teamName.trim() || (!pickedPlace && (!locationText || !locationText.trim()))) {
      // More specific guidance depending on what's missing
      if (!teamName || !teamName.trim()) {
        Toast.show({ type: 'error', text1: 'Team details incomplete', text2: 'Please enter a team name.' });
      } else {
        Toast.show({ type: 'error', text1: 'Team details incomplete', text2: 'Please provide a location for the team (use "Find with Google" or enter an address).' });
      }
      return;
    }

    setLoading(true);
    try {
      await ensureFirestoreOnline();

      // Best-effort: read the user's Firestore profile to pick up their full name (signup flow writes `name`)
      let creatorName: string | null = null;
      let creatorEmail: string | null = null;
      try {
        const userDoc = await getDocument(`users/${user.uid}`);
        if (userDoc) {
          creatorName = (userDoc.name ?? userDoc.displayName ?? '') || null;
          creatorEmail = (userDoc.email ?? '') || null;

          // BLOCK: disallow creating another team if user is already a coordinator
          if (userDoc.isCoordinator) {
            Toast.show({
              type: 'error',
              text1: 'Cannot create team',
              text2: 'You are already a coordinator for a team and cannot create another one.',
            });
            setLoading(false);
            return;
          }

          // BLOCK: disallow creating a team if user is already a member of a team
          if (userDoc.teamId) {
            Toast.show({
              type: 'error',
              text1: 'Cannot create team',
              text2: 'You are already a member of a team. Leave your current team before creating a new one.',
            });
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        // If reading the user doc fails, fall back to auth profile values but still proceed with caution.
        console.warn('[CreateTeam] failed to read users/{uid} for coordinator check', e);
        creatorName = user.displayName ?? null;
        creatorEmail = user.email ?? null;
        // Note: server-side rules will still enforce creation permissions; we surface helpful client messages when possible.
      }

      const coordEntry = { uid: user.uid, name: creatorName ?? (user.displayName ?? ''), email: creatorEmail ?? (user.email ?? '') };

      const payload: any = {
        teamName: teamName.trim(),
        location: pickedPlace?.formattedAddress ?? locationText ?? '',
        latitude: pickedPlace?.lat ?? null,
        longitude: pickedPlace?.lng ?? null,
        placeId: pickedPlace?.placeId ?? '',
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        homeColor,
        awayColor,
        // coordinator metadata (init with the creating user)
        coordinators: [coordEntry],
        coordinatorNames: [coordEntry.name ?? ''],
      };

      const ref: any = await addDocSafe('teams', payload);
      const createdId = ref?.id ?? (typeof ref?.path === 'string' ? String(ref.path).split('/').pop() : null);
      Toast.show({ type: 'success', text1: 'Team created' });

      if (createdId) {
        // update the user's profile to attach them to this team and make them a coordinator
        try {
          await upsertUserDoc(user.uid, { teamId: createdId, isCoordinator: true, email: user.email ?? '', name: creatorName ?? user.displayName ?? '' });
        } catch (uErr) {
          console.warn('[CreateTeam] failed to upsert users/{uid}', uErr);
        }

        // Emit an event so other screens can react (e.g., refresh lists)
        try { emitAppEvent('team:created', { teamId: createdId }); } catch {}

        // Navigate to the coordinator dashboard so it can load the newly updated user/team
        router.replace('/(tabs)/CoordinatorDashboardScreen');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      console.error('[CreateTeam] create failed', e);
      // Try to show server-provided error message when available
      const msg = e?.message ?? String(e);
      Toast.show({ type: 'error', text1: 'Create failed', text2: msg });
    } finally {
      setLoading(false);
    }
  };

  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <TouchableOpacity onPress={() => setActivePicker(label.toLowerCase() as 'home' | 'away')}>
      <View style={styles.jerseyCard}>
        <View style={styles.jerseyBox}>
          <ExpoImage
            source={require('../../assets/images/jersey_fill.png')}
            style={[styles.jerseyImg, { tintColor: color }]}
            contentFit="contain"
          />
          <ExpoImage
            source={require('../../assets/images/jersey_outline.png')}
            style={styles.jerseyImg}
            contentFit="contain"
          />
        </View>
        <Text style={styles.jerseyLabel}>{label}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Create a New Team</Text>

      <TextInput
        style={styles.input}
        placeholder="Team Name"
        value={teamName}
        onChangeText={setTeamName}
      />

      <View style={{ width: '100%' }}>
        <TextInput
          style={styles.input}
          placeholder="Location (rink or arena)"
          value={locationText}
          onChangeText={(text) => {
            setLocationText(text);
            // If typing after a pickedPlace, clear the picked place so user can choose a different location
            if (pickedPlace && (pickedPlace.formattedAddress !== text && pickedPlace.name !== text)) {
              setPickedPlace(null);
            }
          }}
        />

        {/* Inline suggestions */}
        {loadingPredictions ? (
          <View style={styles.suggestions}>
            <Text style={{ color: '#666' }}>Searching...</Text>
          </View>
        ) : null}

        {!loadingPredictions && predictions && predictions.length > 0 ? (
          <View style={styles.suggestions}>
            {predictions.map((p) => (
              <TouchableOpacity
                key={p.place_id}
                onPress={() => handleSelectPrediction(p)}
                style={styles.suggestionItem}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionMain}>{p.structured_formatting?.main_text ?? p.description}</Text>
                {p.structured_formatting?.secondary_text ? (
                  <Text style={styles.suggestionSecondary}>{p.structured_formatting.secondary_text}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.lookupRow}>
        <Button title="Find with Google" onPress={handleLookupPlace} disabled={loading} />
      </View>

      <View style={styles.kitRow}>
        <Jersey color={homeColor} label="Home" />
        <Jersey color={awayColor} label="Away" />
      </View>

      {/* Color Picker Modal */}
      <Modal visible={!!activePicker} animationType="slide" onRequestClose={() => setActivePicker(null)}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>
            Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color
          </Text>
          <ColorPicker
            color={activePicker === 'home' ? homeColor : awayColor}
            onColorChangeComplete={(color: string) => {
              if (activePicker === 'home') setHomeColor(color);
              else setAwayColor(color);
            }}
            thumbSize={30}
            sliderSize={30}
            noSnap
            row={false}
            swatches
          />
          <View style={{ marginTop: 12 }}>
            <Button title="Done" onPress={() => setActivePicker(null)} />
          </View>
        </View>
      </Modal>

      <View style={{ marginTop: 20 }}>
        <Button
          title={loading ? 'Creating...' : 'Create Team'}
          onPress={handleCreateTeam}
          disabled={loading}
          color="#0a7ea4"
        />
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 10 }} /> : null}

      {pickedPlace ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: '600' }}>Selected</Text>
          <Text>{pickedPlace.name ?? pickedPlace.formattedAddress}</Text>
          <Text style={{ color: '#666' }}>{pickedPlace.formattedAddress}</Text>
          <Text style={{ color: '#666' }}>
            {pickedPlace.lat ?? 'n/a'}, {pickedPlace.lng ?? 'n/a'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0a7ea4',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    width: '100%',
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  lookupRow: { width: '100%', marginTop: 8, marginBottom: 12 },
  kitRow: { flexDirection: 'row', gap: 20, marginTop: 12, marginBottom: 12 },
  jerseyCard: { alignItems: 'center', width: 140 },
  jerseyBox: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  jerseyImg: { width: 120, height: 120, position: 'absolute' },
  jerseyLabel: { marginTop: 6, fontSize: 14, fontWeight: '600', color: '#333' },

  modalContainer: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#0a7ea4' },

  suggestions: { width: '100%', backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#eee', marginTop: 6, padding: 8 },
  suggestionItem: { paddingVertical: 8 },
  suggestionMain: { fontWeight: '600' },
  suggestionSecondary: { color: '#666', fontSize: 12 },

});
