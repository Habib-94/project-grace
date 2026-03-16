import { useAuth } from '@/context/AuthContext';
import { haversineDistanceKm } from '@/src/locations';
import { addDoc, collection, doc, getDoc, getDocs, getFirestore, serverTimestamp } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
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

const KM_TO_MILES = 0.621371;
const db = getFirestore();

interface GameDoc {
  id: string;
  title?: string;
  startISO?: string;
  teamId?: string;
  teamName?: string;
  createdBy?: string;
  createdByName?: string;
  latitude?: number;
  longitude?: number;
  location?: { lat?: number; lng?: number; label?: string };
  homeColor?: string;
  teamHomeColor?: string;
  awayColor?: string;
  teamRating?: number;
  elo?: number;
  expiresAt?: string;
  distanceMiles?: number;
  teamLocationFirstLine?: string;
}

interface TeamDoc {
  id: string;
  teamName?: string;
  location?: string;
  homeColor?: string;
  awayColor?: string;
  elo?: number;
}

function getReadableTextColor(bg?: string): string {
  try {
    if (!bg) return '#000';
    let c = bg.trim().replace('#', '');
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    if (c.length !== 6) return '#000';
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 ? '#fff' : '#000';
  } catch { return '#000'; }
}

export default function FindGamesScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GameDoc[]>([]);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [userTeamElo, setUserTeamElo] = useState<number | null>(null);
  // Date range filter
  type DateChip = 'any' | 'today' | 'week' | 'fortnight' | 'month' | 'custom';
  const [dateChip, setDateChip] = useState<DateChip>('any');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<GameDoc | null>(null);
  const [modalTeam, setModalTeam] = useState<TeamDoc | null>(null);
  const [requesting, setRequesting] = useState(false);

  // ── Location ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingLocation(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Toast.show({ type: 'info', text1: 'Location permission required' });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e) {
        console.warn('[FindGames] location failed', e);
      } finally {
        if (mounted) setLoadingLocation(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ── Auto-search once coords are ready ──────────────────────────────────

  useEffect(() => {
    if (userCoords) searchNearbyGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoords]);

  // ── Load user's team ELO for fallback ranking ───────────────────────────

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const teamId = userSnap.data()?.teamId as string | undefined;
        if (!teamId) return;
        const teamSnap = await getDoc(doc(db, 'teams', teamId));
        const elo = teamSnap.data()?.elo as number | undefined;
        if (mounted && elo != null) setUserTeamElo(elo);
      } catch {
        // non-critical, fallback sort will use distance only
      }
    })();
    return () => { mounted = false; };
  }, [user]);

  // ── Search ─────────────────────────────────────────────────────────────────

  const searchNearbyGames = async () => {
    if (!user) { router.push('/(auth)/LoginScreen'); return; }

    setSearching(true);
    setFallbackMode(false);
    try {
      const nowMs = Date.now();
      const snap = await getDocs(collection(db, 'games'));

      // Build all valid (non-expired) games; attach distance only if we have coords
      const allValid: GameDoc[] = snap.docs
        .map((d) => {
          const data = d.data();
          const expiry = data.expiresAt
            ? new Date(data.expiresAt as string).getTime()
            : data.startISO ? new Date(data.startISO as string).getTime() : null;
          if (expiry != null && expiry <= nowMs) return null;
          const lat = (data.latitude ?? data.lat ?? data.location?.lat) as number | undefined;
          const lng = (data.longitude ?? data.lng ?? data.location?.lng) as number | undefined;
          const distanceMiles =
            userCoords && lat != null && lng != null
              ? haversineDistanceKm(userCoords.lat, userCoords.lng, lat, lng) * KM_TO_MILES
              : undefined;
          return {
            id: d.id,
            ...data,
            distanceMiles,
            teamLocationFirstLine:
              typeof data.location?.label === 'string'
                ? data.location.label.split('\n')[0]?.split(',')[0]?.trim()
                : undefined,
          } as GameDoc;
        })
        .filter((g): g is GameDoc => g !== null);

      // Apply date range filter
      const dateFilteredValid = (() => {
        if (dateChip === 'any') return allValid;
        const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0,0,0,0); return c.getTime(); };
        const endOfDay   = (d: Date) => { const c = new Date(d); c.setHours(23,59,59,999); return c.getTime(); };
        const now = new Date();
        let fromMs: number;
        let toMs: number;
        if (dateChip === 'today') {
          fromMs = startOfDay(now); toMs = endOfDay(now);
        } else if (dateChip === 'week') {
          fromMs = startOfDay(now);
          const end = new Date(now); end.setDate(end.getDate() + 6);
          toMs = endOfDay(end);
        } else if (dateChip === 'fortnight') {
          fromMs = startOfDay(now);
          const end = new Date(now); end.setDate(end.getDate() + 13);
          toMs = endOfDay(end);
        } else if (dateChip === 'month') {
          fromMs = startOfDay(now);
          const end = new Date(now); end.setDate(end.getDate() + 29);
          toMs = endOfDay(end);
        } else {
          // custom — parse DD/MM/YYYY
          const parseDate = (s: string): Date | null => {
            const parts = s.trim().split('/');
            if (parts.length !== 3) return null;
            const [dd, mm, yyyy] = parts.map(Number);
            if (!dd || !mm || !yyyy) return null;
            return new Date(yyyy, mm - 1, dd);
          };
          const f = customFrom ? parseDate(customFrom) : null;
          const t = customTo   ? parseDate(customTo)   : null;
          fromMs = f ? startOfDay(f) : 0;
          toMs   = t ? endOfDay(t)   : Infinity;
        }
        return allValid.filter((g) => {
          if (!g.startISO) return true; // no date — always include
          const ts = new Date(g.startISO).getTime();
          return ts >= fromMs && ts <= toMs;
        });
      })();

      // If no location available, just show all date-filtered games sorted by date
      if (!userCoords) {
        const sorted = [...dateFilteredValid].sort((a, b) =>
          (a.startISO ?? '').localeCompare(b.startISO ?? '')
        );
        setResults(sorted);
        setFallbackMode(false);
        if (sorted.length === 0) Toast.show({ type: 'info', text1: 'No upcoming games found' });
        return;
      }

      // Primary: games within the chosen radius
      const inRadius = dateFilteredValid
        .filter((g) => (g.distanceMiles ?? Infinity) <= radiusMiles)
        .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));

      if (inRadius.length > 0) {
        setResults(inRadius);
        setFallbackMode(false);
        return;
      }

      // Fallback: no games in radius — sort by combined distance + ELO proximity
      // Score = 0.7 * normalisedDistance + 0.3 * normalisedEloDiff
      // Both normalised to [0..1] across the candidate set so neither dominates.
      if (dateFilteredValid.length === 0) {
        setResults([]);
        Toast.show({ type: 'info', text1: 'No upcoming games found for this date range' });
        return;
      }

      const maxDist = Math.max(...dateFilteredValid.map((g) => g.distanceMiles ?? 0), 1);
      const myElo = userTeamElo ?? 1500;
      const eloDiffs = dateFilteredValid.map((g) => Math.abs((g.teamRating ?? g.elo ?? 1500) - myElo));
      const maxEloDiff = Math.max(...eloDiffs, 1);

      const scored = dateFilteredValid
        .map((g, i) => ({
          game: g,
          score: 0.7 * ((g.distanceMiles ?? maxDist) / maxDist) + 0.3 * (eloDiffs[i] / maxEloDiff),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 20)
        .map((s) => s.game);

      setResults(scored);
      setFallbackMode(true);
    } catch (e: unknown) {
      console.warn('[FindGames] search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed' });
    } finally {
      setSearching(false);
    }
  };

  // ── Modal ──────────────────────────────────────────────────────────────────

  const openGameModal = async (game: GameDoc) => {
    setSelectedGame(game);
    setModalTeam(null);
    setModalVisible(true);
    if (game.teamId) {
      try {
        const snap = await getDoc(doc(db, 'teams', game.teamId));
        if (snap.exists) setModalTeam({ id: snap.id, ...snap.data() } as TeamDoc);
      } catch (e) {
        console.warn('[FindGames] failed to load team for modal', e);
      }
    }
  };

  // ── Request game ───────────────────────────────────────────────────────────

  const requestGame = async () => {
    if (!selectedGame || !user) return;
    setRequesting(true);
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const me = userSnap.data();
      if (!me) { Toast.show({ type: 'error', text1: 'User record not found' }); return; }
      if (!me.teamId) { Toast.show({ type: 'info', text1: 'Join or create a team first' }); return; }

      await addDoc(collection(db, 'gameRequests'), {
        teamId: selectedGame.teamId ?? null,
        requestingTeamId: me.teamId,
        requestingTeamName: (me.teamName ?? me.displayName ?? '') as string,
        homeTeamId: selectedGame.teamId ?? null,
        homeTeamName: selectedGame.teamName ?? '',
        gameId: selectedGame.id,
        title: selectedGame.title ?? `${selectedGame.teamName ?? 'Team'} game request`,
        startISO: selectedGame.startISO ?? null,
        status: 'pending',
        createdAt: serverTimestamp(),
        requestedBy: user.uid,
        createdBy: user.uid,
        requestedByName: (me.name ?? user.displayName ?? '') as string,
        requestedByEmail: (me.email ?? user.email ?? '') as string,
        requestedByRating: (me.elo ?? me.rating ?? null) as number | null,
      });

      Toast.show({ type: 'success', text1: 'Game request sent', text2: 'The coordinator will review it.' });
      setModalVisible(false);
      setSelectedGame(null);
    } catch (e: unknown) {
      console.error('[FindGames] requestGame failed', e);
      Toast.show({ type: 'error', text1: 'Failed to send request' });
    } finally {
      setRequesting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Find Games</Text>

      {loadingLocation && <ActivityIndicator style={styles.locationIndicator} />}
      {!loadingLocation && !userCoords && <Text style={styles.locationUnavailable}>Location not available</Text>}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.radiusInput}
          value={String(radiusMiles)}
          keyboardType="numeric"
          onChangeText={(t) => { const n = Number(t); setRadiusMiles(isFinite(n) ? Math.max(0, n) : 0); }}
        />
        <Text style={styles.radiusLabel}>miles radius</Text>
        <TouchableOpacity
          style={[styles.searchButton, (searching || loadingLocation) && styles.buttonDisabled]}
          onPress={searchNearbyGames}
          disabled={searching || loadingLocation}
        >
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Date range chips */}
      {(() => {
        const CHIPS: { key: typeof dateChip extends string ? string : never; label: string }[] = [
          { key: 'any',       label: 'Any date' },
          { key: 'today',     label: 'Today' },
          { key: 'week',      label: 'Next 7 days' },
          { key: 'fortnight', label: 'Next 14 days' },
          { key: 'month',     label: 'Next 30 days' },
          { key: 'custom',    label: 'Custom' },
        ] as const;
        return (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsContent}>
              {CHIPS.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, dateChip === c.key && styles.chipActive]}
                  onPress={() => setDateChip(c.key as typeof dateChip)}
                >
                  <Text style={[styles.chipText, dateChip === c.key && styles.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {dateChip === 'custom' && (
              <View style={styles.customDateRow}>
                <View style={styles.customDateField}>
                  <Text style={styles.customDateLabel}>From (DD/MM/YYYY)</Text>
                  <TextInput
                    style={styles.customDateInput}
                    placeholder="DD/MM/YYYY"
                    value={customFrom}
                    onChangeText={setCustomFrom}
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
                <View style={styles.customDateField}>
                  <Text style={styles.customDateLabel}>To (DD/MM/YYYY)</Text>
                  <TextInput
                    style={styles.customDateInput}
                    placeholder="DD/MM/YYYY"
                    value={customTo}
                    onChangeText={setCustomTo}
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
              </View>
            )}
          </>
        );
      })()}

      {searching ? <ActivityIndicator style={styles.searchingIndicator} /> : (
        <>
          {fallbackMode && (
            <View style={styles.fallbackBanner}>
              <Text style={styles.fallbackBannerText}>
                No games within {radiusMiles} miles — showing nearest matches by location &amp; rating
              </Text>
            </View>
          )}
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const dt = item.startISO ? new Date(item.startISO) : null;
              const bg = item.teamHomeColor ?? item.homeColor ?? '#ffffff';
              const textColor = getReadableTextColor(bg);
              const eloDiff = userTeamElo != null
                ? Math.abs((item.teamRating ?? item.elo ?? 1500) - userTeamElo)
                : null;
              return (
                <View style={[styles.card, { backgroundColor: bg }]}>
                  <Text style={[styles.cardTitle, { color: textColor }]}>{item.title ?? item.teamName ?? 'Game'}</Text>
                  <Text style={{ color: textColor }}>{dt ? dt.toLocaleString() : 'TBA'}</Text>
                  <Text style={{ color: textColor }}>Distance: {item.distanceMiles != null ? `${item.distanceMiles.toFixed(1)} mi` : '—'}</Text>
                  <Text style={{ color: textColor }}>Team: {item.teamName ?? '—'}</Text>
                  {item.teamLocationFirstLine ? <Text style={{ color: textColor }}>{item.teamLocationFirstLine}</Text> : null}
                  {eloDiff != null && (
                    <Text style={{ color: textColor }}>Rating diff: ±{eloDiff} pts</Text>
                  )}
                  <TouchableOpacity style={styles.viewButton} onPress={() => openGameModal(item)}>
                    <Text style={styles.viewButtonText}>View</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No upcoming games found.</Text>
              </View>
            }
          />
        </>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedGame?.title ?? selectedGame?.teamName ?? 'Game details'}</Text>
            <Text style={styles.modalDetail}>When: {selectedGame?.startISO ? new Date(selectedGame.startISO).toLocaleString() : 'TBA'}</Text>
            <Text style={styles.modalDetail}>Where: {selectedGame?.teamLocationFirstLine ?? modalTeam?.location ?? 'Unknown'}</Text>
            <Text style={styles.modalDetail}>Team: {modalTeam?.teamName ?? selectedGame?.teamName ?? 'Unknown'}</Text>
            <View style={styles.kitRow}>
              <View style={[styles.kitSwatch, { backgroundColor: modalTeam?.homeColor ?? (selectedGame?.teamHomeColor ?? '#fff') }]} />
              <Text style={styles.modalDetail}>Home kit</Text>
              <View style={styles.kitSwatchGap} />
              <View style={[styles.kitSwatch, { backgroundColor: modalTeam?.awayColor ?? (selectedGame?.awayColor ?? '#fff') }]} />
              <Text style={styles.modalDetail}>Away kit</Text>
            </View>
            <Text style={styles.modalDetail}>Team Rating: {selectedGame?.teamRating ?? selectedGame?.elo ?? modalTeam?.elo ?? '—'}</Text>
            <Text style={[styles.modalDetail, styles.modalDetailLast]}>Coordinator: {selectedGame?.createdByName ?? 'Unknown'}</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setModalVisible(false); setSelectedGame(null); }} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
              {user?.uid === selectedGame?.createdBy ? (
                <View style={styles.yourGameBadge}><Text style={styles.yourGameText}>Your Game</Text></View>
              ) : (
                <Pressable onPress={requestGame} disabled={requesting} style={styles.requestButton}>
                  <Text style={styles.requestButtonText}>{requesting ? 'Sending...' : 'Request Game'}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  header: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  locationIndicator: { marginBottom: 12 },
  locationUnavailable: { color: '#666', marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  radiusInput: { width: 80, borderWidth: 1, borderColor: '#ddd', padding: 8, borderRadius: 6, backgroundColor: '#fff' },
  radiusLabel: { color: '#333' },
  searchButton: { backgroundColor: '#FF3B30', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  searchButtonText: { color: '#fff', fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
  searchingIndicator: { marginTop: 12 },
  chipsScroll: { marginBottom: 8 },
  chipsContent: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#0a7ea4', backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#0a7ea4' },
  chipText: { fontSize: 13, color: '#0a7ea4', fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  customDateRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  customDateField: { flex: 1 },
  customDateLabel: { fontSize: 11, color: '#555', marginBottom: 3 },
  customDateInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, fontSize: 14, backgroundColor: '#fff' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 10 },
  cardTitle: { fontWeight: '700', marginBottom: 4 },
  viewButton: { marginTop: 8, backgroundColor: '#0a7ea4', padding: 8, borderRadius: 6, alignItems: 'center' },
  viewButtonText: { color: '#fff', fontWeight: '600' },
  emptyContainer: { padding: 12 },
  emptyText: { color: '#666' },
  fallbackBanner: { backgroundColor: '#FFF3CD', borderWidth: 1, borderColor: '#FFCA28', borderRadius: 8, padding: 10, marginBottom: 10 },
  fallbackBannerText: { color: '#7A5800', fontSize: 13, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: '#fff', borderRadius: 8, padding: 16, maxHeight: '90%' },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalDetail: { color: '#333', marginBottom: 4 },
  modalDetailLast: { marginTop: 8, marginBottom: 12 },
  kitRow: { flexDirection: 'row', marginTop: 8, alignItems: 'center' },
  kitSwatch: { width: 16, height: 16, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  kitSwatchGap: { width: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  closeButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#eee' },
  closeButtonText: { color: '#333' },
  requestButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#0a7ea4' },
  requestButtonText: { color: '#fff' },
  yourGameBadge: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#4CAF50' },
  yourGameText: { color: '#fff', fontWeight: '600' },
});