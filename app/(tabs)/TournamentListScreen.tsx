import { useAuth } from '@/context/AuthContext';
import { haversineDistanceKm } from '@/src/locations';
import type { Tournament } from '@/src/types/firestore';
import { collection, getDocs, getFirestore, query, where } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';

const db = getFirestore();
const KM_TO_MILES = 0.621371;

type FilterStatus = 'open' | 'in_progress' | 'all';

export default function TournamentListScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('open');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isCoordinator, setIsCoordinator] = useState(false);

  // Get user location and coordinator status
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const checkCoordinator = async () => {
      try {
        const { getDoc, doc } = await import('@react-native-firebase/firestore');
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) setIsCoordinator(!!(snap.data() as Record<string, unknown>)?.isCoordinator);
      } catch {}
    };
    checkCoordinator();
  }, [user?.uid]);

  const fetchTournaments = useCallback(async () => {
    try {
      let q;
      if (filterStatus === 'all') {
        q = query(collection(db, 'tournaments'));
      } else {
        q = query(
          collection(db, 'tournaments'),
          where('status', '==', filterStatus)
        );
      }
      const snap = await getDocs(q);
      const docs = (snap.docs as Array<{ id: string; data(): Record<string, unknown> }>).map(
        (d) => ({ id: d.id, ...d.data() } as Tournament)
      );
      // Sort client-side by createdAt descending (avoids composite index requirement)
      docs.sort((a, b) => {
        const aTime = (a.createdAt as { seconds?: number } | null)?.seconds ?? 0;
        const bTime = (b.createdAt as { seconds?: number } | null)?.seconds ?? 0;
        return bTime - aTime;
      });
      setTournaments(docs);
    } catch (e) {
      console.warn('[TournamentList] fetch failed', e);
      Toast.show({ type: 'error', text1: 'Failed to load tournaments' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus]);

  // Re-fetch whenever the screen gains focus (handles navigating back from create/detail)
  useFocusEffect(
    React.useCallback(() => {
      fetchTournaments();
    }, [fetchTournaments])
  );

  const onRefresh = () => { setRefreshing(true); fetchTournaments(); };

  const getDistanceLabel = (t: Tournament): string | null => {
    if (!userCoords) return null;
    if (t.venueType === 'single' && t.venueLatitude != null && t.venueLongitude != null) {
      const miles = haversineDistanceKm(userCoords.lat, userCoords.lng, t.venueLatitude, t.venueLongitude) * KM_TO_MILES;
      return `${miles.toFixed(1)} mi`;
    }
    if (t.locationGateLat != null && t.locationGateLng != null) {
      const miles = haversineDistanceKm(userCoords.lat, userCoords.lng, t.locationGateLat, t.locationGateLng) * KM_TO_MILES;
      return `~${miles.toFixed(1)} mi area`;
    }
    return null;
  };

  const statusBadgeStyle = (status: string) => {
    switch (status) {
      case 'open': return styles.badgeOpen;
      case 'in_progress': return styles.badgeInProgress;
      case 'completed': return styles.badgeCompleted;
      default: return styles.badgeCancelled;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'open': return 'Open';
      case 'in_progress': return 'In Progress';
      case 'completed': return 'Completed';
      default: return 'Cancelled';
    }
  };

  const renderItem = ({ item }: { item: Tournament }) => {
    const dist = getDistanceLabel(item);
    const teamsIn = item.teams?.length ?? 0;
    const spotsLeft = item.maxTeams - teamsIn;
    const startDate = new Date(item.startDate).toLocaleDateString();
    const endDate = new Date(item.endDate).toLocaleDateString();

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push({ pathname: '/(tabs)/TournamentDetailScreen', params: { tournamentId: item.id } })}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.badge, statusBadgeStyle(item.status)]}>
            <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
          </View>
        </View>

        <Text style={styles.cardHost}>Hosted by {item.hostTeamName}</Text>

        <View style={styles.tagRow}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{item.format === 'knockout' ? '🏆 Knockout' : '🔵 Group + Playoff'}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{item.venueType === 'single' ? '📍 Single Venue' : '🏟️ Home/Away'}</Text>
          </View>
          {item.maxTeams > 0 && (
            <View style={[styles.tag, spotsLeft <= 2 && styles.tagWarning]}>
              <Text style={styles.tagText}>{teamsIn}/{item.maxTeams} teams{spotsLeft > 0 ? ` · ${spotsLeft} spots` : ' · Full'}</Text>
            </View>
          )}
        </View>

        {(item.eloMin != null || item.eloMax != null) && (
          <Text style={styles.cardMeta}>
            ELO: {item.eloMin ?? '—'} – {item.eloMax ?? '—'}
          </Text>
        )}

        {item.locationGateLabel && (
          <Text style={styles.cardMeta}>📍 Location: {item.locationGateLabel}{item.locationRadiusMiles ? ` (${item.locationRadiusMiles} mi)` : ''}</Text>
        )}

        {dist && <Text style={styles.cardDist}>{dist} away</Text>}

        <Text style={styles.cardDates}>{startDate} → {endDate}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Tournaments</Text>
        {isCoordinator && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/(tabs)/CreateTournamentScreen')}
          >
            <Text style={styles.createButtonText}>+ Create</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['open', 'in_progress', 'all'] as FilterStatus[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filterStatus === f && styles.filterTabActive]}
            onPress={() => setFilterStatus(f)}
          >
            <Text style={[styles.filterTabText, filterStatus === f && styles.filterTabTextActive]}>
              {f === 'open' ? 'Open' : f === 'in_progress' ? 'In Progress' : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0a7ea4" />
        </View>
      ) : tournaments.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Text style={styles.emptyText}>No tournaments found.</Text>
          {isCoordinator && (
            <TouchableOpacity style={styles.createButton} onPress={() => router.push('/(tabs)/CreateTournamentScreen')}>
              <Text style={styles.createButtonText}>Create the first one</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0a7ea4' },
  createButton: { backgroundColor: '#0a7ea4', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  createButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 8 },
  filterTab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f5f5f5' },
  filterTabActive: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  filterTabText: { color: '#555', fontSize: 13, fontWeight: '500' },
  filterTabTextActive: { color: '#fff' },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e0e0e0', elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111', flex: 1, marginRight: 8 },
  cardHost: { fontSize: 13, color: '#555', marginBottom: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { backgroundColor: '#e8f4fb', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagWarning: { backgroundColor: '#fff3cd' },
  tagText: { fontSize: 12, color: '#0a7ea4', fontWeight: '500' },
  cardMeta: { fontSize: 12, color: '#666', marginBottom: 2 },
  cardDist: { fontSize: 12, color: '#888', marginTop: 2 },
  cardDates: { fontSize: 12, color: '#888', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  badgeOpen: { backgroundColor: '#28a745' },
  badgeInProgress: { backgroundColor: '#fd7e14' },
  badgeCompleted: { backgroundColor: '#6c757d' },
  badgeCancelled: { backgroundColor: '#dc3545' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#888', fontSize: 15, marginBottom: 16 },
});
