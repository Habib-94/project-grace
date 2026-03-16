import { useAuth } from '@/context/AuthContext';
import { geocodeAddress } from '@/src/locations';
import type { TournamentFormat, TournamentVenueType } from '@/src/types/firestore';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getFirestore,
    serverTimestamp,
} from '@react-native-firebase/firestore';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Toast from 'react-native-toast-message';

const db = getFirestore();
const GOOGLE_MAPS_API_KEY = (Constants.expoConfig?.extra?.googleMapsApiKey as string) ?? '';

const MAX_TEAMS_OPTIONS = [4, 8, 16, 32];

export default function CreateTournamentScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // Guard: coordinator only
  const [isCoordinator, setIsCoordinator] = useState(false);
  const [hostTeamId, setHostTeamId] = useState('');
  const [hostTeamName, setHostTeamName] = useState('');
  const [hostTeamElo, setHostTeamElo] = useState<number>(1500);
  const [hostTeamLat, setHostTeamLat] = useState<number | null>(null);
  const [hostTeamLng, setHostTeamLng] = useState<number | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('knockout');
  const [venueType, setVenueType] = useState<TournamentVenueType>('single');
  const [maxTeams, setMaxTeams] = useState(8);

  // Dates
  const [startDate, setStartDate] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [endDate, setEndDate] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() + 7 + 90); return d; });
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Single venue
  const [venueName, setVenueName] = useState('');
  const [venueSearching, setVenueSearching] = useState(false);
  const [venueLatitude, setVenueLatitude] = useState<number | null>(null);
  const [venueLongitude, setVenueLongitude] = useState<number | null>(null);

  // ELO restrictions
  const [useEloRestriction, setUseEloRestriction] = useState(false);
  const [eloMin, setEloMin] = useState('1200');
  const [eloMax, setEloMax] = useState('1800');

  // Location restrictions
  const [useLocationRestriction, setUseLocationRestriction] = useState(false);
  const [locationGateLabel, setLocationGateLabel] = useState('');
  const [locationGateLat, setLocationGateLat] = useState<number | null>(null);
  const [locationGateLng, setLocationGateLng] = useState<number | null>(null);
  const [locationRadiusMiles, setLocationRadiusMiles] = useState('50');
  const [locationSearching, setLocationSearching] = useState(false);

  const [creating, setCreating] = useState(false);
  const [knockoutLegs, setKnockoutLegs] = useState<1 | 3 | 5>(1);
  const [groupLegsPerPairing, setGroupLegsPerPairing] = useState<1 | 2 | 3>(1);

  // ── Load coordinator/team data ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists) return;
        const data = userSnap.data() as Record<string, unknown>;
        if (!data.isCoordinator || !data.teamId) return;
        setIsCoordinator(true);
        setHostTeamId(data.teamId as string);
        const teamSnap = await getDoc(doc(db, 'teams', data.teamId as string));
        if (teamSnap.exists()) {
          const td = teamSnap.data() as Record<string, unknown>;
          setHostTeamName((td.teamName as string) ?? '');
          setHostTeamElo((td.elo as number) ?? 1500);
          setHostTeamLat((td.latitude as number) ?? null);
          setHostTeamLng((td.longitude as number) ?? null);
          // Pre-fill location gate with team location
          if (td.location) setLocationGateLabel(td.location as string);
          if (td.latitude) setLocationGateLat(td.latitude as number);
          if (td.longitude) setLocationGateLng(td.longitude as number);
          // Pre-fill venue for single venue with team location
          if (td.location) setVenueName(td.location as string);
          if (td.latitude) setVenueLatitude(td.latitude as number);
          if (td.longitude) setVenueLongitude(td.longitude as number);
        }
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, [user?.uid]);

  const geocodeVenue = async () => {
    if (!venueName.trim()) return;
    if (!GOOGLE_MAPS_API_KEY) { Toast.show({ type: 'error', text1: 'No Maps API key' }); return; }
    setVenueSearching(true);
    try {
      const geo = await geocodeAddress(venueName.trim());
      if (geo?.lat != null && geo?.lng != null) {
        setVenueLatitude(geo.lat);
        setVenueLongitude(geo.lng);
        Toast.show({ type: 'success', text1: 'Venue located' });
      } else {
        Toast.show({ type: 'info', text1: 'Could not geocode venue — coordinates will be approximate' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Geocode failed' });
    } finally {
      setVenueSearching(false);
    }
  };

  const geocodeLocationGate = async () => {
    if (!locationGateLabel.trim()) return;
    if (!GOOGLE_MAPS_API_KEY) { Toast.show({ type: 'error', text1: 'No Maps API key' }); return; }
    setLocationSearching(true);
    try {
      const geo = await geocodeAddress(locationGateLabel.trim());
      if (geo?.lat != null && geo?.lng != null) {
        setLocationGateLat(geo.lat);
        setLocationGateLng(geo.lng);
        Toast.show({ type: 'success', text1: 'Location set' });
      } else {
        Toast.show({ type: 'info', text1: 'Could not geocode location' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Geocode failed' });
    } finally {
      setLocationSearching(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { Toast.show({ type: 'error', text1: 'Tournament name is required' }); return; }
    if (startDate >= endDate) { Toast.show({ type: 'error', text1: 'End date must be after start date' }); return; }
    if (venueType === 'single' && !venueName.trim()) { Toast.show({ type: 'error', text1: 'Venue name is required for single venue tournaments' }); return; }

    const eloMinNum = useEloRestriction ? parseInt(eloMin, 10) : null;
    const eloMaxNum = useEloRestriction ? parseInt(eloMax, 10) : null;
    if (useEloRestriction && (isNaN(eloMinNum!) || isNaN(eloMaxNum!))) {
      Toast.show({ type: 'error', text1: 'Invalid ELO values' }); return;
    }
    const radiusNum = useLocationRestriction ? parseFloat(locationRadiusMiles) : null;
    if (useLocationRestriction && (isNaN(radiusNum!) || radiusNum! <= 0)) {
      Toast.show({ type: 'error', text1: 'Invalid location radius' }); return;
    }

    setCreating(true);
    try {
      const hostEntry = {
        teamId: hostTeamId,
        teamName: hostTeamName,
        elo: hostTeamElo,
        signedUpAt: new Date().toISOString(),
        ...(hostTeamLat != null ? { latitude: hostTeamLat } : {}),
        ...(hostTeamLng != null ? { longitude: hostTeamLng } : {}),
      };

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        hostTeamId,
        hostTeamName,
        hostUserId: user!.uid,
        format,
        venueType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        maxTeams,
        status: 'open',
        teams: [hostEntry],
        createdAt: serverTimestamp(),
        ...(format === 'knockout' ? { knockoutLegs } : {}),
        ...(format === 'group_playoff' ? { groupLegsPerPairing } : {}),
        eloMin: eloMinNum,
        eloMax: eloMaxNum,
        locationRadiusMiles: radiusNum,
        locationGateLat: useLocationRestriction ? locationGateLat : null,
        locationGateLng: useLocationRestriction ? locationGateLng : null,
        locationGateLabel: useLocationRestriction ? locationGateLabel.trim() || null : null,
      };

      if (venueType === 'single') {
        payload.venueName = venueName.trim();
        payload.venueLatitude = venueLatitude;
        payload.venueLongitude = venueLongitude;
      }

      const ref = await addDoc(collection(db, 'tournaments'), payload);
      Toast.show({ type: 'success', text1: 'Tournament created!' });
      router.replace({ pathname: '/(tabs)/TournamentDetailScreen', params: { tournamentId: ref.id } });
    } catch (e) {
      console.error('[CreateTournament] failed', e);
      Toast.show({ type: 'error', text1: 'Failed to create tournament' });
    } finally {
      setCreating(false);
    }
  };

  if (checkingAuth) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#0a7ea4" /></View>;
  }

  if (!isCoordinator) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Only team coordinators can create tournaments.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Tournament</Text>
        <Text style={styles.hostLabel}>Hosting as: <Text style={styles.hostName}>{hostTeamName}</Text></Text>

        {/* Name */}
        <Text style={styles.label}>Tournament Name *</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Winter Cup 2026" placeholderTextColor="#999" />

        {/* Description */}
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="Rules, notes, contact info..." placeholderTextColor="#999" multiline numberOfLines={3} />

        {/* Format */}
        <Text style={styles.label}>Format</Text>
        <View style={styles.optionRow}>
          {(['knockout', 'group_playoff'] as TournamentFormat[]).map((f) => (
            <Pressable key={f} style={[styles.option, format === f && styles.optionActive]} onPress={() => setFormat(f)}>
              <Text style={[styles.optionText, format === f && styles.optionTextActive]}>
                {f === 'knockout' ? '🏆 Knockout' : '🔵 Group + Playoff'}
              </Text>
            </Pressable>
          ))}
        </View>
        {/* Series / leg settings — conditional on format */}
        {format === 'knockout' && (
          <>
            <Text style={styles.label}>Series Format (per Knockout Match)</Text>
            <View style={styles.optionRow}>
              {([1, 3, 5] as (1 | 3 | 5)[]).map((n) => (
                <Pressable key={n} style={[styles.option, knockoutLegs === n && styles.optionActive]} onPress={() => setKnockoutLegs(n)}>
                  <Text style={[styles.optionText, knockoutLegs === n && styles.optionTextActive]}>
                    {n === 1 ? '1 Game' : `Best of ${n}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            {knockoutLegs > 1 && (
              <Text style={styles.hint}>First team to win {Math.ceil(knockoutLegs / 2)} games advances. Home/away alternates each leg.</Text>
            )}
          </>
        )}

        {format === 'group_playoff' && (
          <>
            <Text style={styles.label}>Group Stage Legs per Pairing</Text>
            <View style={styles.optionRow}>
              {([1, 2, 3] as (1 | 2 | 3)[]).map((n) => (
                <Pressable key={n} style={[styles.option, groupLegsPerPairing === n && styles.optionActive]} onPress={() => setGroupLegsPerPairing(n)}>
                  <Text style={[styles.optionText, groupLegsPerPairing === n && styles.optionTextActive]}>
                    {n === 1 ? '1 Game' : `${n} Games`}
                  </Text>
                </Pressable>
              ))}
            </View>
            {groupLegsPerPairing > 1 && (
              <Text style={styles.hint}>Each pair plays {groupLegsPerPairing} times. Home/away alternates on even legs.</Text>
            )}
          </>
        )}
        {/* Venue type */}
        <Text style={styles.label}>Venue Type</Text>
        <View style={styles.optionRow}>
          {(['single', 'multi'] as TournamentVenueType[]).map((v) => (
            <Pressable key={v} style={[styles.option, venueType === v && styles.optionActive]} onPress={() => setVenueType(v)}>
              <Text style={[styles.optionText, venueType === v && styles.optionTextActive]}>
                {v === 'single' ? '📍 Single Venue' : '🏟️ Home/Away'}
              </Text>
            </Pressable>
          ))}
        </View>
        {venueType === 'multi' && (
          <Text style={styles.hint}>Home/Away: games will be scheduled at each home team's available slots.</Text>
        )}

        {/* Single venue location */}
        {venueType === 'single' && (
          <>
            <Text style={styles.label}>Venue / Arena *</Text>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={venueName}
                onChangeText={setVenueName}
                placeholder="Arena name or address"
                placeholderTextColor="#999"
                onSubmitEditing={geocodeVenue}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.geoButton} onPress={geocodeVenue} disabled={venueSearching}>
                {venueSearching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.geoButtonText}>Locate</Text>}
              </TouchableOpacity>
            </View>
            {venueLatitude != null && (
              <Text style={styles.hint}>✓ Coordinates set ({venueLatitude.toFixed(4)}, {venueLongitude?.toFixed(4)})</Text>
            )}
          </>
        )}

        {/* Max teams */}
        <Text style={styles.label}>Max Teams</Text>
        <View style={styles.optionRow}>
          {MAX_TEAMS_OPTIONS.map((n) => (
            <Pressable key={n} style={[styles.option, maxTeams === n && styles.optionActive]} onPress={() => setMaxTeams(n)}>
              <Text style={[styles.optionText, maxTeams === n && styles.optionTextActive]}>{n}</Text>
            </Pressable>
          ))}
        </View>

        {/* Dates */}
        <Text style={styles.label}>Start Date</Text>
        <TouchableOpacity style={styles.dateButton} onPress={() => setShowStartPicker(true)}>
          <Text style={styles.dateButtonText}>{startDate.toLocaleDateString()}</Text>
        </TouchableOpacity>
        {showStartPicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={(_, d) => { setShowStartPicker(false); if (d) setStartDate(d); }}
          />
        )}

        <Text style={styles.label}>End Date</Text>
        <TouchableOpacity style={styles.dateButton} onPress={() => setShowEndPicker(true)}>
          <Text style={styles.dateButtonText}>{endDate.toLocaleDateString()}</Text>
        </TouchableOpacity>
        {showEndPicker && (
          <DateTimePicker
            value={endDate}
            mode="date"
            display="default"
            minimumDate={startDate}
            onChange={(_, d) => { setShowEndPicker(false); if (d) setEndDate(d); }}
          />
        )}

        {/* ELO restriction */}
        <View style={styles.switchRow}>
          <Text style={styles.label}>ELO Restriction</Text>
          <Switch value={useEloRestriction} onValueChange={setUseEloRestriction} trackColor={{ true: '#0a7ea4' }} />
        </View>
        {useEloRestriction && (
          <View style={styles.rangeRow}>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>Min ELO</Text>
              <TextInput style={styles.rangeInput} value={eloMin} onChangeText={setEloMin} keyboardType="numeric" />
            </View>
            <Text style={styles.rangeSep}>–</Text>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>Max ELO</Text>
              <TextInput style={styles.rangeInput} value={eloMax} onChangeText={setEloMax} keyboardType="numeric" />
            </View>
          </View>
        )}

        {/* Location restriction */}
        <View style={styles.switchRow}>
          <Text style={styles.label}>Location Restriction</Text>
          <Switch value={useLocationRestriction} onValueChange={setUseLocationRestriction} trackColor={{ true: '#0a7ea4' }} />
        </View>
        {useLocationRestriction && (
          <>
            <Text style={styles.hint}>Only teams within the radius of the chosen location can sign up.</Text>
            <View style={styles.rowInput}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={locationGateLabel}
                onChangeText={setLocationGateLabel}
                placeholder="City or area (e.g. Manchester)"
                placeholderTextColor="#999"
                onSubmitEditing={geocodeLocationGate}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.geoButton} onPress={geocodeLocationGate} disabled={locationSearching}>
                {locationSearching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.geoButtonText}>Set</Text>}
              </TouchableOpacity>
            </View>
            {locationGateLat != null && (
              <Text style={styles.hint}>✓ Location set ({locationGateLat.toFixed(4)}, {locationGateLng?.toFixed(4)})</Text>
            )}
            <Text style={styles.label}>Radius (miles)</Text>
            <TextInput style={styles.input} value={locationRadiusMiles} onChangeText={setLocationRadiusMiles} keyboardType="numeric" />
          </>
        )}

        <TouchableOpacity
          style={[styles.createButton, creating && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={creating}
        >
          {creating
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.createButtonText}>Create Tournament</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#0a7ea4', marginBottom: 4 },
  hostLabel: { fontSize: 13, color: '#666', marginBottom: 20 },
  hostName: { color: '#0a7ea4', fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 14, color: '#111', backgroundColor: '#fafafa', marginBottom: 4 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  option: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f5f5f5' },
  optionActive: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  optionText: { fontSize: 13, color: '#555', fontWeight: '500' },
  optionTextActive: { color: '#fff' },
  hint: { fontSize: 12, color: '#888', marginBottom: 4, fontStyle: 'italic' },
  rowInput: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  geoButton: { backgroundColor: '#0a7ea4', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  geoButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  dateButton: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fafafa' },
  dateButtonText: { fontSize: 14, color: '#111' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  rangeField: { flex: 1 },
  rangeLabel: { fontSize: 12, color: '#666', marginBottom: 4 },
  rangeInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 14, color: '#111', backgroundColor: '#fafafa' },
  rangeSep: { fontSize: 18, color: '#666', marginTop: 16 },
  createButton: { backgroundColor: '#0a7ea4', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 28 },
  createButtonDisabled: { opacity: 0.6 },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelButton: { padding: 12, alignItems: 'center', marginTop: 10 },
  cancelButtonText: { color: '#888', fontSize: 14 },
  errorText: { color: '#dc3545', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  backButton: { backgroundColor: '#0a7ea4', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  backButtonText: { color: '#fff', fontWeight: '600' },
});
