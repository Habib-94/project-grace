import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDoc, collection, doc, getDoc, getFirestore, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import { Picker } from '@react-native-picker/picker';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

import { useAuth } from '@/context/AuthContext';
import { emitAppEvent } from '@/src/appEvents';
import TutorialModal from '@/src/components/TutorialModal';
import { geocodeAddress, getPlaceDetails } from '@/src/locations';
import {
    rateLimiter,
    sanitizeColor,
    sanitizeLocation,
    sanitizeText,
    validateTeamName,
} from '@/src/utils/security';
import Constants from 'expo-constants';

const API_KEY = (Constants.expoConfig?.extra?.googleMapsApiKey as string) ?? '';
const db = getFirestore();

type Prediction = {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
};

type SkillLevel = 'learn' | 'development' | 'experienced';

function getSkillRating(level: SkillLevel): number {
  switch (level) {
    case 'learn': return 800;
    case 'development': return 1400;
    case 'experienced': return 2400;
  }
}

const TUTORIAL_STEPS = [
  {
    title: 'Create a team',
    body: 'Give your team a name and pick a location (rink or arena). Use "Find with Google" to quickly select a place. Choose your Home and Away kit colours and then tap Create Team.',
    size: 'small' as const,
    primaryLabel: 'Next',
  },
  {
    title: 'After creating',
    body: 'You will become the Coordinator for the team. Coordinators can invite members, manage requests, and schedule games from the Manage Team screen.',
    size: 'small' as const,
    primaryLabel: 'Got it',
  },
];

export default function CreateTeamScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [teamName, setTeamName] = useState('');
  const [locationText, setLocationText] = useState('');
  const [pickedPlace, setPickedPlace] = useState<{
    placeId?: string;
    name?: string;
    formattedAddress?: string;
    lat?: number;
    lng?: number;
  } | null>(null);
  const [showMapPreview, setShowMapPreview] = useState(false);
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('development');
  const [loading, setLoading] = useState(false);
  const [createTeamBlocked, setCreateTeamBlocked] = useState(false);
  const [blockedTeamName, setBlockedTeamName] = useState<string | null>(null);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);

  const acAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tutorialKey = user?.uid ? `tutorial_seen:${user.uid}:create_team` : null;

  // ── Tutorial one-shot ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!tutorialKey) return;
    AsyncStorage.getItem(tutorialKey)
      .then((seen) => { if (!seen) setTutorialVisible(true); })
      .catch(console.warn);
  }, [tutorialKey]);

  const dismissTutorial = async () => {
    try { if (tutorialKey) await AsyncStorage.setItem(tutorialKey, '1'); } catch {}
    setTutorialVisible(false);
    setTutorialStep(0);
  };

  // ── Coordinator check ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.uid) return;
    let mounted = true;

    getDoc(doc(db, 'users', user.uid)).then(async (snap) => {
      if (!mounted || !snap.exists) return;
      const data = snap.data()!;
      if (data.isCoordinator) {
        setCreateTeamBlocked(true);
        if (data.teamId) {
          try {
            const teamSnap = await getDoc(doc(db, 'teams', data.teamId as string));
            if (mounted) setBlockedTeamName((teamSnap.data()?.teamName as string) ?? null);
          } catch {}
        }
      }
    }).catch(console.warn);

    return () => { mounted = false; };
  }, [user?.uid]);

  // ── Autocomplete ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!locationText || pickedPlace?.formattedAddress === locationText || pickedPlace?.name === locationText) {
      setPredictions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(locationText), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      acAbortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationText]);

  async function fetchPredictions(input: string) {
    if (!API_KEY || input.trim().length < 2) return;
    setLoadingPredictions(true);
    acAbortRef.current?.abort();
    const ac = new AbortController();
    acAbortRef.current = ac;
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=establishment&language=en&key=${API_KEY}`;
      const res = await fetch(url, { signal: ac.signal });
      const json = await res.json();
      if (json?.status === 'OK' && Array.isArray(json.predictions)) {
        setPredictions(json.predictions.slice(0, 6));
      } else {
        setPredictions([]);
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') console.warn('[CreateTeam] autocomplete failed', e);
      setPredictions([]);
    } finally {
      setLoadingPredictions(false);
    }
  }

  const handleSelectPrediction = async (p: Prediction) => {
    setLoading(true);
    try {
      const details = await getPlaceDetails(p.place_id);
      if (details) {
        setPickedPlace(details);
        setLocationText(details.formattedAddress ?? details.name ?? p.description);
      } else {
        setLocationText(p.description);
      }
      setPredictions([]);
    } catch (e: unknown) {
      Toast.show({ type: 'error', text1: 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleLookupPlace = async () => {
    if (locationText.trim().length < 3) {
      Toast.show({ type: 'info', text1: 'Enter an address or rink name first' });
      return;
    }
    setLoading(true);
    try {
      const res = await geocodeAddress(locationText.trim());
      if (!res) {
        Toast.show({ type: 'error', text1: 'No results', text2: 'Google did not return a match.' });
      } else {
        setPickedPlace(res);
        setLocationText(res.formattedAddress ?? res.name ?? locationText.trim());
        setPredictions([]);
        setShowMapPreview(true);
      }
    } catch (e: unknown) {
      Toast.show({ type: 'error', text1: 'Lookup failed' });
    } finally {
      setLoading(false);
    }
  };

  // ── Create team ────────────────────────────────────────────────────────────

  const handleCreateTeam = async () => {
    if (!user) {
      Toast.show({ type: 'error', text1: 'Sign in required' });
      router.replace('/(auth)/LoginScreen');
      return;
    }

    if (!rateLimiter.isAllowed(`createTeam:${user.uid}`, 3, 60 * 60 * 1000)) {
      const resetMs = rateLimiter.getResetTime(`createTeam:${user.uid}`, 60 * 60 * 1000);
      Toast.show({ type: 'error', text1: 'Too many attempts', text2: `Wait ${Math.ceil(resetMs / 60000)} minutes.` });
      return;
    }

    const sanitizedName = sanitizeText(teamName, 50);
    const nameValidation = validateTeamName(sanitizedName);
    if (!nameValidation.valid) {
      Toast.show({ type: 'error', text1: 'Invalid team name', ...(nameValidation.error ? { text2: nameValidation.error } : {}) });
      return;
    }

    if (!sanitizedName || (!pickedPlace && !locationText.trim())) {
      Toast.show({ type: 'error', text1: 'Missing details', text2: !sanitizedName ? 'Enter a team name.' : 'Enter a location.' });
      return;
    }

    setLoading(true);
    try {
      // Check coordinator/team membership via native Firestore
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const userData = userSnap.data() ?? {};

      if (userData.isCoordinator) {
        Toast.show({ type: 'error', text1: 'Cannot create team', text2: 'You are already a coordinator.' });
        return;
      }
      if (userData.teamId) {
        Toast.show({ type: 'error', text1: 'Cannot create team', text2: 'Leave your current team first.' });
        return;
      }

      const sanitizedLocation = sanitizeLocation(pickedPlace?.formattedAddress ?? locationText);
      const coordEntry = {
        uid: user.uid,
        name: sanitizeText((userData.name as string) ?? user.displayName ?? '', 100),
        email: (userData.email as string) ?? user.email ?? '',
      };

      const ref = await addDoc(collection(db, 'teams'), {
        teamName: sanitizedName,
        location: sanitizedLocation,
        latitude: pickedPlace?.lat ?? null,
        longitude: pickedPlace?.lng ?? null,
        placeId: sanitizeText(pickedPlace?.placeId ?? '', 200),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        homeColor: sanitizeColor(homeColor),
        awayColor: sanitizeColor(awayColor),
        elo: getSkillRating(skillLevel),
        coordinators: [coordEntry],
        coordinatorNames: [coordEntry.name],
      });

      await setDoc(doc(db, 'users', user.uid),
        { teamId: ref.id, isCoordinator: true, email: user.email ?? '', name: coordEntry.name },
        { merge: true }
      );

      try { emitAppEvent('team:created', { teamId: ref.id }); } catch {}
      Toast.show({ type: 'success', text1: 'Team created' });
      router.replace('/(tabs)/CoordinatorDashboardScreen');
    } catch (e: unknown) {
      console.error('[CreateTeam] failed', e);
      Toast.show({ type: 'error', text1: 'Create failed' });
    } finally {
      setLoading(false);
    }
  };

  // ── Sub-components ─────────────────────────────────────────────────────────

  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <TouchableOpacity onPress={() => setActivePicker(label.toLowerCase() as 'home' | 'away')}>
      <View style={styles.jerseyCard}>
        <View style={styles.jerseyBox}>
          <ExpoImage source={require('@/assets/images/jersey_fill.png')} style={[styles.jerseyImg, { tintColor: color }]} contentFit="contain" />
          <ExpoImage source={require('@/assets/images/jersey_outline.png')} style={styles.jerseyImg} contentFit="contain" />
        </View>
        <Text style={styles.jerseyLabel}>{label}</Text>
      </View>
    </TouchableOpacity>
  );

  // ── Blocked state ──────────────────────────────────────────────────────────

  if (createTeamBlocked) {
    return (
      <View style={styles.center}>
        <Text style={styles.blockedTitle}>You are already a team Coordinator</Text>
        <Text style={styles.blockedBody}>
          Leave your current team from the Manage Team screen before creating a new one.
          {blockedTeamName ? ` (${blockedTeamName})` : ''}
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')}>
          <Text style={styles.buttonText}>Manage Team</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/(tabs)')}>
          <Text style={styles.buttonText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <>
      {tutorialVisible && (
        <TutorialModal
          visible={tutorialVisible}
          onClose={dismissTutorial}
          onPrimary={async () => {
            if (tutorialStep < TUTORIAL_STEPS.length - 1) {
              setTutorialStep((s) => s + 1);
            } else {
              await dismissTutorial();
            }
          }}
          primaryLabel={TUTORIAL_STEPS[tutorialStep]?.primaryLabel ?? 'Got it'}
          size={TUTORIAL_STEPS[tutorialStep]?.size ?? 'small'}
          title={TUTORIAL_STEPS[tutorialStep]?.title}
          body={TUTORIAL_STEPS[tutorialStep]?.body}
        />
      )}

      <Modal visible={!!activePicker} animationType="slide" onRequestClose={() => setActivePicker(null)}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color</Text>
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
          <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={() => setActivePicker(null)}>
            <Text style={styles.buttonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showMapPreview} animationType="slide" onRequestClose={() => setShowMapPreview(false)}>
        <View style={styles.mapModalContainer}>
          <View style={styles.mapModalHeader}>
            <Text style={styles.mapModalTitle}>Location Preview</Text>
            <TouchableOpacity onPress={() => setShowMapPreview(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          {pickedPlace?.lat && pickedPlace?.lng ? (
            <>
              <View style={styles.mapContainer}>
                <ExpoImage
                  source={{ uri: `https://maps.googleapis.com/maps/api/staticmap?center=${pickedPlace.lat},${pickedPlace.lng}&zoom=15&size=600x400&markers=color:red%7C${pickedPlace.lat},${pickedPlace.lng}&key=${API_KEY}` }}
                  style={styles.mapImage}
                  contentFit="cover"
                />
              </View>
              <View style={styles.mapInfoContainer}>
                <Text style={styles.mapInfoText}>{pickedPlace.formattedAddress ?? pickedPlace.name}</Text>
              </View>
              <View style={styles.mapModalButtons}>
                <TouchableOpacity style={[styles.button, styles.confirmButton]} onPress={() => setShowMapPreview(false)}>
                  <Text style={styles.buttonText}>Confirm Location</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.center}><Text>No location data available</Text></View>
          )}
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create a New Team</Text>

        <TextInput
          style={styles.input}
          placeholder="Team Name"
          value={teamName}
          onChangeText={setTeamName}
          editable={!loading}
        />

        <View style={styles.fullWidth}>
          <TextInput
            style={styles.input}
            placeholder="Location (rink or arena)"
            value={locationText}
            onChangeText={(text) => {
              setLocationText(text);
              if (pickedPlace && pickedPlace.formattedAddress !== text && pickedPlace.name !== text) {
                setPickedPlace(null);
              }
            }}
            editable={!loading}
          />
          {loadingPredictions && (
            <View style={styles.suggestions}>
              <Text style={styles.searchingText}>Searching...</Text>
            </View>
          )}
          {!loadingPredictions && predictions.length > 0 && (
            <View style={styles.suggestions}>
              {predictions.map((p) => (
                <TouchableOpacity key={p.place_id} onPress={() => handleSelectPrediction(p)} style={styles.suggestionItem} activeOpacity={0.7}>
                  <Text style={styles.suggestionMain}>{p.structured_formatting?.main_text ?? p.description}</Text>
                  {p.structured_formatting?.secondary_text && (
                    <Text style={styles.suggestionSecondary}>{p.structured_formatting.secondary_text}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <TouchableOpacity style={[styles.button, styles.lookupButton]} onPress={handleLookupPlace} disabled={loading}>
          <Text style={styles.buttonText}>Find with Google</Text>
        </TouchableOpacity>

        <View style={styles.skillLevelContainer}>
          <Text style={styles.skillLevelLabel}>Skill Level:</Text>
          <View style={styles.pickerContainer}>
            <Picker selectedValue={skillLevel} onValueChange={(v) => setSkillLevel(v)} style={styles.picker}>
              <Picker.Item label="Learn to Play" value="learn" />
              <Picker.Item label="Development" value="development" />
              <Picker.Item label="Experienced" value="experienced" />
            </Picker>
          </View>
          <Text style={styles.skillLevelHint}>
            {skillLevel === 'learn' && 'Starting rating: 800 (Beginner level)'}
            {skillLevel === 'development' && 'Starting rating: 1,400 (Intermediate level)'}
            {skillLevel === 'experienced' && 'Starting rating: 2,400 (Advanced level)'}
          </Text>
        </View>

        <View style={styles.kitRow}>
          <Jersey color={homeColor} label="Home" />
          <Jersey color={awayColor} label="Away" />
        </View>

        <TouchableOpacity
          style={[styles.button, styles.createButton, loading && styles.buttonDisabled]}
          onPress={handleCreateTeam}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Team'}</Text>
        </TouchableOpacity>

        {loading && <ActivityIndicator style={styles.spinner} />}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  container: { flexGrow: 1, alignItems: 'center', padding: 20, backgroundColor: '#fff' },
  fullWidth: { width: '100%' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, width: '100%', padding: 12, marginBottom: 10, backgroundColor: '#fff' },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center', width: '100%', marginVertical: 4 },
  secondaryButton: { backgroundColor: '#666', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  lookupButton: { marginTop: 4, marginBottom: 12 },
  createButton: { marginTop: 20 },
  confirmButton: { backgroundColor: '#0a7ea4' },
  spinner: { marginTop: 10 },
  blockedTitle: { fontSize: 18, fontWeight: '700', color: '#0a7ea4', marginBottom: 8 },
  blockedBody: { color: '#666', textAlign: 'center', marginBottom: 18 },
  skillLevelContainer: { width: '100%', marginBottom: 16 },
  skillLevelLabel: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 },
  pickerContainer: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' },
  picker: { width: '100%', height: Platform.OS === 'ios' ? 120 : 50 },
  skillLevelHint: { fontSize: 13, color: '#666', marginTop: 6, fontStyle: 'italic' },
  kitRow: { flexDirection: 'row', gap: 20, marginTop: 12, marginBottom: 12 },
  jerseyCard: { alignItems: 'center', width: 140 },
  jerseyBox: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  jerseyImg: { width: 120, height: 120, position: 'absolute' },
  jerseyLabel: { marginTop: 6, fontSize: 14, fontWeight: '600', color: '#333' },
  modalContainer: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#0a7ea4' },
  suggestions: { width: '100%', backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#eee', marginTop: 4, marginBottom: 8, padding: 8 },
  searchingText: { color: '#666' },
  suggestionItem: { paddingVertical: 8 },
  suggestionMain: { fontWeight: '600' },
  suggestionSecondary: { color: '#666', fontSize: 12 },
  mapModalContainer: { flex: 1, backgroundColor: '#fff' },
  mapModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  mapModalTitle: { fontSize: 18, fontWeight: '700', color: '#0a7ea4' },
  closeButton: { padding: 8 },
  closeButtonText: { fontSize: 24, color: '#666', fontWeight: '300' },
  mapContainer: { flex: 1, margin: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#ddd' },
  mapImage: { width: '100%', height: '100%' },
  mapInfoContainer: { padding: 16, backgroundColor: '#f9f9f9' },
  mapInfoText: { fontSize: 14, color: '#333', textAlign: 'center' },
  mapModalButtons: { padding: 16, paddingBottom: 32 },
});
