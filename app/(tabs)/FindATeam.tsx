import { useAuth } from '@/context/AuthContext';
import TutorialModal from '@/src/components/TutorialModal';
import { geocodeAddress, haversineDistanceKm } from '@/src/locations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDoc, collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, where } from '@react-native-firebase/firestore';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

// ─── Constants ────────────────────────────────────────────────────────────────

const KM_TO_MILES = 0.621371;
const DEFAULT_RADIUS_MILES = 15;
const GOOGLE_MAPS_API_KEY = (Constants.expoConfig?.extra?.googleMapsApiKey as string) ?? '';
const db = getFirestore();

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  teamName: string;
  location?: string;
  homeColor?: string;
  awayColor?: string;
  elo?: number;
  latitude?: number;
  longitude?: number;
  /** Coordinators who opted to share their email. Keyed by uid. */
  coordinatorContacts?: Record<string, { name?: string; email: string }>;
}

interface TeamWithDistance extends Team {
  distanceMiles: number;
}

interface Coordinator {
  uid: string;
  name?: string;
  email?: string;
  shareEmail?: boolean;
}

// ─── Tutorial steps (defined outside component) ───────────────────────────────

const TUTORIAL_STEPS = [
  {
    title: 'Find a Team',
    body: 'Search for teams by city, rink or team name. Use "Search Area" to geolocate an area. The directory shows nearby or popular clubs. Tap a team to view details and request to join.',
    size: 'small' as const,
    primaryLabel: 'Next',
  },
  {
    title: 'Request to Join',
    body: 'When you find a team you like, tap it and choose "Request to Join". The team coordinator will review your request.',
    size: 'small' as const,
    primaryLabel: 'Got it',
  },
];

// ── Location ───────────────────────────────────────────────────────────────

const useLocation = () => {
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingLocation(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e) {
        console.warn('[FindATeam] location failed', e);
      } finally {
        if (mounted) setLoadingLocation(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return { userCoords, loadingLocation };
};

// ── Tutorial one-shot ──────────────────────────────────────────────────────

const useTutorial = (key: string | null) => {
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  useEffect(() => {
    if (!key) return;
    AsyncStorage.getItem(key)
      .then((seen) => { if (!seen) setTutorialVisible(true); })
      .catch(console.warn);
  }, [key]);

  const dismissTutorial = useCallback(async () => {
    try { if (key) await AsyncStorage.setItem(key, '1'); } catch {}
    setTutorialVisible(false);
    setTutorialStep(0);
  }, [key]);

  return { tutorialVisible, tutorialStep, setTutorialStep, dismissTutorial };
};

// ── Component ─────────────────────────────────────────────────────────────

export default function FindATeam() {
  const router = useRouter();
  const { user } = useAuth();
  const { userCoords, loadingLocation } = useLocation();

  const tutorialKey = user?.uid ? `tutorial_seen:${user.uid}:find_team` : null;
  const { tutorialVisible, tutorialStep, setTutorialStep, dismissTutorial } = useTutorial(tutorialKey);

  const [dirLoading, setDirLoading] = useState(false);
  const [directory, setDirectory] = useState<Team[]>([]);
  const [results, setResults] = useState<TeamWithDistance[]>([]);
  const [searching, setSearching] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);

// ── Fetch directory from Firestore ─────────────────────────────────────────

const fetchDirectory = useCallback(async (coords?: { lat: number; lng: number } | null) => {
  setDirLoading(true);
  try {
    const snap = await getDocs(collection(db, 'teams'));
    const teams: Team[] = (snap.docs as Array<{ id: string; data(): Record<string, unknown> }>).map((d) => {
      const data = d.data();
      return {
        id: d.id,
        teamName: (data.teamName as string) ?? '',
        ...(data.location != null ? { location: data.location as string } : {}),
        ...(data.homeColor != null ? { homeColor: data.homeColor as string } : {}),
        ...(data.awayColor != null ? { awayColor: data.awayColor as string } : {}),
        ...(data.elo != null ? { elo: data.elo as number } : {}),
        ...(data.latitude != null ? { latitude: data.latitude as number } : {}),
        ...(data.longitude != null ? { longitude: data.longitude as number } : {}),
        ...(data.coordinatorContacts != null ? { coordinatorContacts: data.coordinatorContacts as Record<string, { name?: string; email: string }> } : {}),
      };
    });

    const activeCoords = coords ?? userCoords;
    if (activeCoords) {
      teams.sort((a, b) => {
        const dA = a.latitude != null && a.longitude != null
          ? haversineDistanceKm(activeCoords.lat, activeCoords.lng, a.latitude, a.longitude)
          : Infinity;
        const dB = b.latitude != null && b.longitude != null
          ? haversineDistanceKm(activeCoords.lat, activeCoords.lng, b.latitude, b.longitude)
          : Infinity;
        if (isFinite(dA) && isFinite(dB)) return dA - dB;
        if (isFinite(dA)) return -1;
        if (isFinite(dB)) return 1;
        return (a.teamName).localeCompare(b.teamName);
      });
    } else {
      teams.sort((a, b) => a.teamName.localeCompare(b.teamName));
    }

    setDirectory(teams);
  } catch (e) {
    console.error('[FindATeam] fetchDirectory failed', e);
    Toast.show({ type: 'error', text1: 'Failed to load teams' });
  } finally {
    setDirLoading(false);
  }
}, [userCoords]);

  useEffect(() => { fetchDirectory(userCoords); }, [fetchDirectory]);

  // ── Derive coordinators from the already-loaded team data ─────────────────

  useEffect(() => {
    if (!selectedTeam) {
      setCoordinators([]);
      return;
    }
    const contacts = selectedTeam.coordinatorContacts ?? {};
    const derived: Coordinator[] = Object.entries(contacts).map(([uid, info]) => {
      const coord: Coordinator = { uid, shareEmail: true };
      if (info.name) coord.name = info.name;
      if (info.email) coord.email = info.email;
      return coord;
    });
    setCoordinators(derived);
  }, [selectedTeam]);

// ── Debounced name/location search ─────────────────────────────────────────

const handleSearch = useCallback(
  (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const low = term.trim().toLowerCase();
      const filtered = directory.filter((t) =>
        t.teamName.toLowerCase().includes(low) || (t.location ?? '').toLowerCase().includes(low)
      );
      // Attach distance to filtered results
      const withDist: TeamWithDistance[] = filtered.map((t) => ({
        ...t,
        distanceMiles: userCoords && t.latitude != null && t.longitude != null
          ? haversineDistanceKm(userCoords.lat, userCoords.lng, t.latitude, t.longitude) * KM_TO_MILES
          : Infinity,
      }));
      setResults(withDist);
      if (withDist.length === 0) Toast.show({ type: 'info', text1: 'No teams found', text2: 'Try "Search Area" for location search.' });
    } catch (e) {
      console.warn('[FindATeam] search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed', text2: e instanceof Error ? e.message : '' });
    } finally {
      setSearching(false);
    }
  },
  [directory, userCoords]
);

// ── Geo search ─────────────────────────────────────────────────────────────

const searchTeamsNearCoords = useCallback((targetCoords: { lat: number; lng: number }) => {
  const withDist: TeamWithDistance[] = directory
    .map((t) => ({
      ...t,
      distanceMiles: t.latitude != null && t.longitude != null
        ? haversineDistanceKm(targetCoords.lat, targetCoords.lng, t.latitude, t.longitude) * KM_TO_MILES
        : Infinity,
    }))
    .filter((t) => t.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  if (withDist.length === 0) {
    const closest = directory
      .map((t) => ({
        ...t,
        distanceMiles: t.latitude != null && t.longitude != null
          ? haversineDistanceKm(targetCoords.lat, targetCoords.lng, t.latitude, t.longitude) * KM_TO_MILES
          : Infinity,
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .slice(0, 20);
    setResults(closest);
    Toast.show({ type: 'info', text1: 'No teams in radius — showing closest' });
  } else {
    setResults(withDist);
  }
}, [directory, radiusMiles]);

const handleSearchArea = async () => {
  if (!GOOGLE_MAPS_API_KEY) {
    Toast.show({ type: 'error', text1: 'Search unavailable', text2: 'No Google Maps API key configured.' });
    return;
  }
  if (!searchTerm.trim()) {
    if (userCoords) searchTeamsNearCoords(userCoords);
    else Toast.show({ type: 'info', text1: 'Enter a search area or allow location access.' });
    return;
  }
  setSearching(true);
  try {
    const geo = await geocodeAddress(searchTerm.trim());
    if (geo?.lat != null && geo?.lng != null) {
      searchTeamsNearCoords({ lat: geo.lat, lng: geo.lng });
    } else if (userCoords) {
      Toast.show({ type: 'info', text1: 'Location not found — searching near you' });
      searchTeamsNearCoords(userCoords);
    } else {
      Toast.show({ type: 'info', text1: 'No location found for search term' });
    }
  } catch (e) {
    console.warn('[FindATeam] geocode failed', e);
    Toast.show({ type: 'error', text1: 'Geocode failed' });
  } finally {
    setSearching(false);
  }
};

const handleNearestToMe = () => {
  if (!userCoords) {
    Toast.show({ type: 'info', text1: 'Location unavailable', text2: 'Allow location permissions to enable this.' });
    return;
  }
  searchTeamsNearCoords(userCoords);
};

// ── Send join request ──────────────────────────────────────────────────────

const handleSendRequest = async () => {
  if (!selectedTeam) { Toast.show({ type: 'info', text1: 'Select a team first' }); return; }
  if (!user) { router.replace('/(auth)/LoginScreen'); return; }

  setSending(true);
  try {
    // Check user is not already in a team
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists) {
      Toast.show({ type: 'error', text1: 'User record not found' });
      return;
    }
    if (userSnap.data()?.teamId) {
      Toast.show({ type: 'error', text1: 'Already in a team', text2: 'Leave your current team first.' });
      return;
    }

    // Check no existing pending request for this team
    const existingSnap = await getDocs(query(
      collection(db, 'requests'),
      where('userId', '==', user.uid),
      where('teamId', '==', selectedTeam.id),
      where('status', '==', 'pending')
    ));

    if (!existingSnap.empty) {
      Toast.show({ type: 'info', text1: 'Request already pending', text2: 'You have already requested to join this team.' });
      return;
    }

    await addDoc(collection(db, 'requests'), {
      userId: user.uid,
      userEmail: user.email ?? '',
      teamId: selectedTeam.id,
      teamName: selectedTeam.teamName,
      requestedBy: user.uid,
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    Toast.show({ type: 'success', text1: 'Request sent!', text2: 'The coordinator will review your request.' });
    router.replace('/(tabs)');
  } catch (e: unknown) {
    console.error('[FindATeam] sendRequest failed', e);
    Toast.show({ type: 'error', text1: 'Failed to send request' });
  } finally {
    setSending(false);
  }
};

// ── Render helpers ─────────────────────────────────────────────────────────

const renderTeamCard = ({ item }: { item: Team }) => (
  <TouchableOpacity style={styles.teamCard} onPress={() => setSelectedTeam(item)} accessibilityRole="button">
    <Text style={styles.teamName}>{item.teamName}</Text>
    {item.location ? <Text style={styles.teamLocation}>{item.location}</Text> : null}
    <Text style={styles.teamRating}>Rating: {Math.min(Math.max(item.elo ?? 1500, 800), 3000)}</Text>
  </TouchableOpacity>
);

// ── Render ─────────────────────────────────────────────────────────────────

return (
  <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Find a Team</Text>

    {loadingLocation && <ActivityIndicator style={styles.locationIndicator} />}
    {!loadingLocation && !userCoords && (
      <Text style={styles.locationUnavailable}>Location not available</Text>
    )}

    <View style={styles.searchRow}>
      <TextInput
        style={styles.input}
        placeholder="Search area (city, rink)..."
        value={searchTerm}
        onChangeText={(t) => { setSearchTerm(t); handleSearch(t); }}
        returnKeyType="search"
        onSubmitEditing={handleSearchArea}
      />
      <TouchableOpacity
        style={[styles.button, (searching || dirLoading) && styles.buttonDisabled]}
        onPress={handleSearchArea}
        disabled={searching || dirLoading}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Search Area</Text>
      </TouchableOpacity>
    </View>

    <View style={styles.radiusRow}>
      <TextInput
        style={styles.radiusInput}
        value={String(radiusMiles)}
        keyboardType="numeric"
        onChangeText={(t) => {
          const n = Number(t);
          setRadiusMiles(isFinite(n) ? Math.max(0, n) : DEFAULT_RADIUS_MILES);
        }}
      />
      <Text style={styles.radiusLabel}>miles radius</Text>
    </View>

    <View style={styles.actionRow}>
      <TouchableOpacity
        style={[styles.button, styles.flex1, loadingLocation && styles.buttonDisabled]}
        onPress={handleNearestToMe}
        disabled={loadingLocation}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Nearest to me</Text>
      </TouchableOpacity>
      <View style={styles.gap} />
      <TouchableOpacity
        style={[styles.button, styles.flex1, dirLoading && styles.buttonDisabled]}
        onPress={() => fetchDirectory(userCoords)}
        disabled={dirLoading}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Refresh Teams</Text>
      </TouchableOpacity>
    </View>

    {searching && <ActivityIndicator size="small" color="#0a7ea4" style={styles.searchingIndicator} />}

    {results.length > 0 && !selectedTeam && (
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>Search results</Text>
        <FlatList
          data={results}
          keyExtractor={(i) => i.id}
          renderItem={renderTeamCard}
          scrollEnabled={false}
        />
      </View>
    )}

    {!searchTerm.trim() && (
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>Team directory</Text>
        {dirLoading ? (
          <ActivityIndicator size="small" color="#0a7ea4" style={styles.searchingIndicator} />
        ) : directory.length === 0 ? (
          <Text style={styles.emptyText}>No teams available</Text>
        ) : (
          <FlatList
            data={directory}
            keyExtractor={(i) => i.id}
            renderItem={renderTeamCard}
            scrollEnabled={false}
          />
        )}
      </View>
    )}

    <Modal
      visible={!!selectedTeam}
      transparent
      animationType="fade"
      onRequestClose={() => setSelectedTeam(null)}
    >
      <Pressable style={styles.modalOverlay} onPress={() => setSelectedTeam(null)}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <Text style={styles.selectedTitle}>{selectedTeam?.teamName}</Text>
          {selectedTeam?.location ? (
            <Text style={styles.teamLocation}>{selectedTeam.location}</Text>
          ) : null}
          <Text style={styles.selectedRating}>
            Rating: {Math.min(Math.max(selectedTeam?.elo ?? 1500, 800), 3000)}
          </Text>
          {(selectedTeam?.homeColor || selectedTeam?.awayColor) && (
            <View style={styles.colorRow}>
              {selectedTeam?.homeColor ? (
                <View style={styles.colorItem}>
                  <View style={[styles.colorSwatch, { backgroundColor: selectedTeam.homeColor }]} />
                  <Text style={styles.colorLabel}>Home</Text>
                </View>
              ) : null}
              {selectedTeam?.awayColor ? (
                <View style={styles.colorItem}>
                  <View style={[styles.colorSwatch, { backgroundColor: selectedTeam.awayColor }]} />
                  <Text style={styles.colorLabel}>Away</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Coordinator contacts */}
          <View style={styles.coordinatorsSection}>
            <Text style={styles.coordinatorsTitle}>Coordinators</Text>
            {coordinators.length === 0 ? (
              <Text style={styles.coordinatorsEmpty}>No coordinators have shared their contact details</Text>
            ) : (
              coordinators.map((c) => (
                <View key={c.uid} style={styles.coordinatorRow}>
                  <Text style={styles.coordinatorName}>{c.name ?? 'Coordinator'}</Text>
                  {c.shareEmail && c.email ? (
                    <TouchableOpacity onPress={() => Linking.openURL(`mailto:${c.email}`)} accessibilityRole="link">
                      <Text style={styles.coordinatorEmail}>{c.email}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.coordinatorEmailHidden}>Email not shared</Text>
                  )}
                </View>
              ))
            )}
          </View>

          <TouchableOpacity
            style={[styles.button, styles.requestButton, sending && styles.buttonDisabled]}
            onPress={handleSendRequest}
            disabled={sending}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{sending ? 'Sending...' : 'Request to Join'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={() => setSelectedTeam(null)}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

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
  </ScrollView>
);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0a7ea4', marginBottom: 8 },
  locationIndicator: { marginBottom: 12 },
  locationUnavailable: { color: '#666', marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  radiusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  radiusInput: { width: 80, borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
  radiusLabel: { marginLeft: 8, color: '#333' },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelButton: { backgroundColor: '#FF3B30', marginTop: 8 },
  requestButton: { marginTop: 16 },
  flex1: { flex: 1 },
  gap: { width: 8 },
  searchingIndicator: { marginTop: 12 },
  listSection: { marginTop: 12, width: '100%' },
  emptyText: { color: '#666' },
  teamCard: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 10, backgroundColor: '#f9f9f9' },
  teamName: { fontSize: 18, fontWeight: 'bold', color: '#0a7ea4' },
  teamLocation: { fontSize: 14, color: '#666' },
  teamRating: { marginTop: 6, fontSize: 14, color: '#333', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 24, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  selectedTitle: { fontSize: 22, fontWeight: 'bold', color: '#0a7ea4', marginBottom: 8, textAlign: 'center' },
  selectedRating: { marginTop: 6, fontSize: 14, color: '#333', fontWeight: '600' },
  colorRow: { flexDirection: 'row', marginTop: 12, gap: 16 },
  colorItem: { alignItems: 'center', gap: 4 },
  colorSwatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#ccc' },
  colorLabel: { fontSize: 12, color: '#555' },
  coordinatorsSection: { marginTop: 16, width: '100%', borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12 },
  coordinatorsTitle: { fontSize: 14, fontWeight: '700', color: '#0a7ea4', marginBottom: 8 },
  coordinatorsEmpty: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  coordinatorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  coordinatorName: { fontSize: 14, fontWeight: '600', color: '#333', flex: 1 },
  coordinatorEmail: { fontSize: 13, color: '#0a7ea4', textDecorationLine: 'underline', flexShrink: 1 },
  coordinatorEmailHidden: { fontSize: 13, color: '#aaa', fontStyle: 'italic' },
});