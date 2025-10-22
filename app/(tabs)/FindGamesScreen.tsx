import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';

import { ensureFirestoreOnline } from '../../src/firebaseConfig';
import { runCollectionQuery } from '../../src/firestoreRest';

// Minimal type
type Game = {
  id: string;
  title?: string;
  startISO?: string;
  location?: { lat?: number; lng?: number; label?: string };
  kitColor?: string | null;
  teamId?: string;
  elo?: number;
  createdBy?: string;
};

export default function FindGamesScreen() {
  const router = useRouter();

  // filters
  const [distanceKm, setDistanceKm] = useState<number>(25);
  const [eloMin, setEloMin] = useState<number>(800);
  const [eloMax, setEloMax] = useState<number>(3000);
  const [dateFilter, setDateFilter] = useState<'any' | 'today' | 'next7' | 'next30' | 'thisMonth'>('any');
  const [dateFilterModalVisible, setDateFilterModalVisible] = useState(false);

  // text inputs for free input
  const [distanceText, setDistanceText] = useState(String(distanceKm));
  const [eloMinText, setEloMinText] = useState(String(eloMin));
  const [eloMaxText, setEloMaxText] = useState(String(eloMax));

  useEffect(() => setDistanceText(String(distanceKm)), [distanceKm]);
  useEffect(() => setEloMinText(String(eloMin)), [eloMin]);
  useEffect(() => setEloMaxText(String(eloMax)), [eloMax]);

  // results + loading
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);

  // simple user location fallback (replace with geolocation in production)
  const [userLocation] = useState<{ lat: number; lng: number }>({ lat: 51.509865, lng: -0.118092 });

  // helpers
  function computeEndISOForDateFilter(filter: string) {
    const end = new Date();
    switch (filter) {
      case 'today':
        end.setHours(23, 59, 59, 999);
        return end.toISOString();
      case 'next7':
        end.setDate(end.getDate() + 7);
        end.setHours(23, 59, 59, 999);
        return end.toISOString();
      case 'next30':
        end.setDate(end.getDate() + 30);
        end.setHours(23, 59, 59, 999);
        return end.toISOString();
      case 'thisMonth': {
        const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0);
        lastDay.setHours(23, 59, 59, 999);
        return lastDay.toISOString();
      }
      case 'any':
      default:
        return undefined;
    }
  }

  function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // commit handlers
  function commitDistance() {
    const n = parseInt(distanceText.replace(/[^\d-]/g, ''), 10);
    const safe = Number.isFinite(n) && n > 0 ? n : 1;
    setDistanceKm(safe);
    setDistanceText(String(safe));
  }
  function commitEloMin() {
    let n = parseInt(eloMinText.replace(/[^\d-]/g, ''), 10);
    if (!Number.isFinite(n)) n = 800;
    n = Math.max(800, Math.min(n, eloMax));
    setEloMin(n);
    setEloMinText(String(n));
  }
  function commitEloMax() {
    let n = parseInt(eloMaxText.replace(/[^\d-]/g, ''), 10);
    if (!Number.isFinite(n)) n = 3000;
    n = Math.min(3000, Math.max(n, eloMin));
    setEloMax(n);
    setEloMaxText(String(n));
  }

  // load games (REST runCollectionQuery)
  async function fetchGames() {
    setLoading(true);
    try {
      await ensureFirestoreOnline();
      const now = new Date().toISOString();
      const endISO = computeEndISOForDateFilter(dateFilter);

      // Build where filters for REST: startISO >= now and optional <= endISO
      const where: Array<{ fieldPath: string; op: string; value: any }> = [{ fieldPath: 'startISO', op: 'GREATER_THAN_OR_EQUAL', value: now }];
      if (endISO) where.push({ fieldPath: 'startISO', op: 'LESS_THAN_OR_EQUAL', value: endISO });

      // Rating filters are applied client-side because some docs don't have elo
      const docs = await runCollectionQuery({
        collectionId: 'games',
        where,
        orderBy: [{ fieldPath: 'startISO', direction: 'ASCENDING' }],
        limit: 500,
      });

      const parsed: Game[] = (docs as any[]).map((d) => ({
        id: d.id,
        title: d.title,
        startISO: d.startISO,
        location: d.location,
        kitColor: d.kitColor ?? null,
        teamId: d.teamId,
        elo: d.elo,
        createdBy: d.createdBy,
      }));

      // apply rating + distance client-side
      const filtered = parsed.filter((g) => {
        if (!g.startISO) return false;
        if (g.elo && (g.elo < eloMin || g.elo > eloMax)) return false;
        if (!g.location || typeof g.location.lat !== 'number' || typeof g.location.lng !== 'number') return true;
        const dKm = haversineDistance(userLocation.lat, userLocation.lng, g.location.lat!, g.location.lng!);
        return dKm <= distanceKm;
      });

      setGames(filtered);
    } catch (e: any) {
      console.warn('[FindGames] fetchGames failed', e);
      setGames([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceKm, eloMin, eloMax, dateFilter]);

  function renderGame({ item }: { item: Game }) {
    const start = item.startISO ? new Date(item.startISO).toLocaleString() : 'TBA';
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{item.title ?? 'Game'}</Text>
        <Text style={styles.meta}>{start}</Text>
        {item.location?.label ? <Text style={styles.meta}>{item.location.label}</Text> : null}
        <Text style={styles.meta}>Team: {item.teamId ?? '—'}</Text>
      </View>
    );
  }

  // add near the top of the component (before the `return`), e.g. after your helpers/state:
  const DATE_OPTIONS = {
    any: 'Any',
    today: 'Today',
    next7: 'Next 7 days',
    next30: 'Next 30 days',
    thisMonth: 'This month',
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Find Available Games</Text>

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ marginBottom: 6 }}>Radius (km)</Text>
          <TextInput
            value={distanceText}
            onChangeText={setDistanceText}
            onBlur={commitDistance}
            keyboardType="numeric"
            style={styles.smallInput}
            placeholder="km"
          />
        </View>

        <View style={{ width: 120 }}>
          <Text style={{ marginBottom: 6 }}>Date</Text>
          <Pressable style={[styles.smallBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0a7ea4' }]} onPress={() => setDateFilterModalVisible(true)}>
            <Text style={[styles.smallBtnText, { color: '#0a7ea4' }]}>
              {dateFilter === 'any' ? 'Any' : dateFilter === 'today' ? 'Today' : dateFilter === 'next7' ? 'Next 7d' : dateFilter === 'next30' ? 'Next 30d' : 'This month'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.row, { marginTop: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ marginRight: 8 }}>Rating</Text>
          <TextInput value={eloMinText} onChangeText={setEloMinText} onBlur={commitEloMin} keyboardType="numeric" style={[styles.smallInput, { minWidth: 80 }]} placeholder="800" />
          <Text style={{ marginHorizontal: 8 }}>—</Text>
          <TextInput value={eloMaxText} onChangeText={setEloMaxText} onBlur={commitEloMax} keyboardType="numeric" style={[styles.smallInput, { minWidth: 80 }]} placeholder="3000" />
        </View>

        <Pressable onPress={() => { fetchGames(); }} style={[styles.smallBtn, { marginLeft: 8 }]}>
          <Text style={styles.smallBtnText}>Apply</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 12 }}>
        {loading ? (
          <ActivityIndicator />
        ) : games.length === 0 ? (
          <Text style={{ color: '#666' }}>No available games found</Text>
        ) : (
          <FlatList data={games} keyExtractor={(i) => i.id} renderItem={renderGame} contentContainerStyle={{ paddingBottom: 80 }} />
        )}
      </View>

      {/* Date filter modal */}
      <Modal visible={dateFilterModalVisible} transparent animationType="slide" onRequestClose={() => setDateFilterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainerSmall}>
            <Text style={{ fontWeight: '700', marginBottom: 8 }}>Select Date Filter</Text>
            <Text style={{ marginBottom: 8, fontSize: 16, color: '#333' }}>
              {DATE_OPTIONS[dateFilter]}
            </Text>

            {Object.keys(DATE_OPTIONS).map((key) => (
              <Pressable
                key={key}
                onPress={() => {
                  setDateFilter(key as any);
                  setDateFilterModalVisible(false);
                }}
                style={[styles.modalOption, dateFilter === key ? { backgroundColor: '#e6f7fb' } : undefined]}
              >
                <Text style={styles.modalOptionText}>
                  {DATE_OPTIONS[key as keyof typeof DATE_OPTIONS]}
                </Text>
              </Pressable>
            ))}

            <View style={{ height: 10 }} />
            <Pressable onPress={() => setDateFilterModalVisible(false)} style={[styles.smallBtn, { alignSelf: 'flex-end' }]}>
              <Text style={styles.smallBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  header: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallInput: {
    minWidth: 84,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
    marginHorizontal: 4,
  },
  smallBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
    marginHorizontal: 4,
  },
  smallBtnText: { color: 'white', fontWeight: '600' },
  card: { padding: 10, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 12, backgroundColor: '#fff' },
  title: { fontWeight: '700' },
  meta: { color: '#666', marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainerSmall: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'stretch',
  },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  modalOptionText: {
    fontSize: 16,
  },
});