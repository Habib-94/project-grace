import { useAuth } from '@/context/AuthContext';
import { emitAppEvent, onAppEvent } from '@/src/appEvents';
import firestore from '@react-native-firebase/firestore';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  teamName?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeColor?: string;
  awayColor?: string;
  elo?: number;
}

interface CoordinatorRequest {
  id: string;
  userEmail: string;
  userId: string;
  teamId: string;
  status: string;
}

interface GameRequest {
  id: string;
  teamId?: string;
  requestingTeamId?: string;
  requestingTeamName?: string;
  requestedBy?: string;
  requestedByName?: string;
  requestedByEmail?: string;
  requestedByRating?: number;
  title?: string;
  startISO?: string;
  type?: 'home' | 'away';
  kitColor?: string;
  status?: string;
  createdAt?: string;
}

interface RatingPoint {
  x: number;
  y: number;
  date: string;
}

type DashboardItem = CoordinatorRequest | GameRequest | Record<string, unknown>;

// ─── Error Boundary (defined outside component to avoid re-creation) ──────────

interface PlacesErrorBoundaryProps {
  children: React.ReactNode;
  onError?: () => void;
}
interface PlacesErrorBoundaryState {
  hasError: boolean;
}

class PlacesErrorBoundary extends React.Component<PlacesErrorBoundaryProps, PlacesErrorBoundaryState> {
  constructor(props: PlacesErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): PlacesErrorBoundaryState {
    return { hasError: true };
  }
  override componentDidCatch(error: Error) {
    console.warn('[PlacesErrorBoundary]', error);
    this.props.onError?.();
  }
  override render() {
    return this.state.hasError ? null : (this.props.children as React.ReactElement);
  }
}

// ─── Firestore helpers (native SDK only) ─────────────────────────────────────

async function addDocNative(collection: string, data: Record<string, unknown>) {
  return firestore().collection(collection).add(data);
}

async function updateDocNative(collection: string, id: string, data: Record<string, unknown>) {
  return firestore().collection(collection).doc(id).update(data);
}

async function deleteDocNative(collection: string, id: string) {
  return firestore().collection(collection).doc(id).delete();
}

async function runBatch(ops: Array<{ op: 'update' | 'delete'; col: string; id: string; data?: Record<string, unknown> }>) {
  const batch = firestore().batch();
  for (const o of ops) {
    const ref = firestore().collection(o.col).doc(o.id);
    if (o.op === 'update') batch.update(ref, o.data ?? {});
    else batch.delete(ref);
  }
  return batch.commit();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoordinatorDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [teamData, setTeamData] = useState<Team | null>(null);
  const [requests, setRequests] = useState<CoordinatorRequest[]>([]);
  const [games, setGames] = useState<Record<string, unknown>[]>([]);
  const [gameRequests, setGameRequests] = useState<GameRequest[]>([]);
  const [ratingHistory, setRatingHistory] = useState<RatingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [placesComponent, setPlacesComponent] = useState<React.ComponentType<any> | null>(null);
  const [selectedGameRequest, setSelectedGameRequest] = useState<GameRequest | null>(null);
  const [requestModalVisible, setRequestModalVisible] = useState(false);

  const originalTeamRef = useRef<Team | null>(null);
  const autocompleteRef = useRef<unknown>(null);

  // Load GooglePlacesAutocomplete dynamically
  useEffect(() => {
    let mounted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-google-places-autocomplete');
      if (mounted) setPlacesComponent(mod?.GooglePlacesAutocomplete ?? null);
    } catch {
      if (mounted) setPlacesComponent(null);
    }
    return () => { mounted = false; };
  }, []);

  // ── Initial data load ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.uid) return;
    let isMounted = true;

    const loadData = async () => {
      try {
        const userSnap = await firestore().collection('users').doc(user.uid).get();
        if (!userSnap.exists) {
          Toast.show({ type: 'error', text1: 'User record not found' });
          router.replace('/(tabs)');
          return;
        }

        const userData = userSnap.data()!;

        if (!userData.isCoordinator) {
          Toast.show({ type: 'error', text1: 'Access Denied', text2: 'You must be a coordinator.' });
          router.replace('/(tabs)');
          return;
        }

        const teamId = userData.teamId as string;
        if (!teamId) {
          router.replace('/(tabs)');
          return;
        }

        const teamSnap = await firestore().collection('teams').doc(teamId).get();
        if (!teamSnap.exists) {
          Toast.show({ type: 'error', text1: 'Team not found' });
          router.replace('/(tabs)');
          return;
        }

        const team: Team = { id: teamSnap.id, ...teamSnap.data() as Omit<Team, 'id'> };
        if (isMounted) setTeamData(team);

        const reqSnap = await firestore()
          .collection('requests')
          .where('teamId', '==', teamId)
          .where('status', '==', 'pending')
          .get();

        const fetchedRequests: CoordinatorRequest[] = reqSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CoordinatorRequest, 'id'>),
        }));

        if (isMounted) setRequests(fetchedRequests);
      } catch (e) {
        console.error('[CoordinatorDashboard] loadData failed', e);
        if (isMounted) Toast.show({ type: 'error', text1: 'Error loading team data' });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [user?.uid, router]);

  // ── Fetch games ────────────────────────────────────────────────────────────

  const fetchGames = useCallback(async (teamId: string) => {
    try {
      const snap = await firestore()
        .collection('games')
        .where('teamId', '==', teamId)
        .orderBy('startISO', 'asc')
        .get();
      setGames(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.warn('[CoordinatorDashboard] fetchGames failed', e);
      Toast.show({ type: 'error', text1: 'Failed to load games' });
    }
  }, []);

  useEffect(() => {
    if (teamData?.id) fetchGames(teamData.id);
  }, [teamData?.id, fetchGames]);

  // ── Fetch game requests ────────────────────────────────────────────────────

  const fetchGameRequests = useCallback(async (teamId: string) => {
    try {
      const snap = await firestore()
        .collection('gameRequests')
        .where('teamId', '==', teamId)
        .get();
      setGameRequests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GameRequest, 'id'>) })));
    } catch (e) {
      console.warn('[CoordinatorDashboard] fetchGameRequests failed', e);
    }
  }, []);

  useEffect(() => {
    if (teamData?.id) fetchGameRequests(teamData.id);
    else setGameRequests([]);
  }, [teamData?.id, fetchGameRequests]);

  // ── Listen for game created events ────────────────────────────────────────

  useEffect(() => {
    if (!teamData?.id) return;
    const unsub = onAppEvent('games:created', (payload: { teamId?: string }) => {
      if (!payload?.teamId || payload.teamId === teamData.id) {
        fetchGames(teamData.id!).catch(console.warn);
        fetchGameRequests(teamData.id!).catch(console.warn);
      }
    });
    return () => { try { if (typeof unsub === 'function') unsub(); } catch {} };
  }, [teamData?.id, fetchGames, fetchGameRequests]);

  // ── Rating history ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!games.length || !teamData?.id) { setRatingHistory([]); return; }

    const completed = (games as Array<Record<string, unknown>>)
      .filter((g) => g.status === 'completed' && g.homeScore != null && g.awayScore != null && g.startISO)
      .sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

    if (!completed.length) { setRatingHistory([]); return; }

    const history: RatingPoint[] = [];
    if (teamData.elo != null) history.push({ x: 0, y: teamData.elo, date: 'Initial' });

    completed.forEach((game, index) => {
      const isHome = game.homeTeamId === teamData.id || game.teamId === teamData.id;
      const rating = (isHome ? game.homeNewRating : game.awayNewRating) as number | undefined;
      if (rating != null) {
        history.push({ x: index + 1, y: rating, date: new Date(String(game.startISO)).toLocaleDateString() });
      }
    });

    setRatingHistory(history);
  }, [games, teamData?.id, teamData?.elo]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleApproveGameRequest = async (req: GameRequest) => {
    if (!teamData?.id || !user) return;
    try {
      let awayTeamRating = 1500;
      if (req.requestingTeamId) {
        const snap = await firestore().collection('teams').doc(req.requestingTeamId).get();
        awayTeamRating = (snap.data()?.elo as number) ?? 1500;
      }

      const payload: Record<string, unknown> = {
        teamId: teamData.id,
        teamName: teamData.teamName,
        title: req.title ?? 'Game Request',
        type: req.type ?? 'home',
        startISO: req.startISO ?? new Date().toISOString(),
        location: teamData.location ?? '',
        createdBy: req.requestedBy ?? user.uid,
        createdByName: req.requestedByName ?? user.displayName ?? '',
        createdByEmail: req.requestedByEmail ?? user.email ?? '',
        createdByRating: req.requestedByRating ?? null,
        createdAt: firestore.FieldValue.serverTimestamp(),
        opponentTeamId: req.requestingTeamId ?? null,
        opponentTeamName: req.requestingTeamName ?? null,
        homeTeamRating: teamData.elo ?? 1500,
        awayTeamRating,
        completed: false,
      };
      if (req.kitColor) payload.kitColor = req.kitColor;

      await addDocNative('games', payload);

      try {
        await updateDocNative('gameRequests', req.id, { status: 'approved' });
      } catch {
        await deleteDocNative('gameRequests', req.id);
      }

      Toast.show({ type: 'success', text1: 'Game created', text2: `${req.requestingTeamName ?? 'Team'} — scheduled` });
      await fetchGames(teamData.id);
      await fetchGameRequests(teamData.id);
      setRequestModalVisible(false);
      setSelectedGameRequest(null);
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] approveGameRequest failed', e);
      Toast.show({ type: 'error', text1: 'Approve failed' });
    }
  };

  const handleRejectGameRequest = async (reqId: string) => {
    try {
      try {
        await updateDocNative('gameRequests', reqId, { status: 'rejected' });
      } catch {
        await deleteDocNative('gameRequests', reqId);
      }
      Toast.show({ type: 'info', text1: 'Game request rejected' });
      if (teamData?.id) fetchGameRequests(teamData.id);
      setRequestModalVisible(false);
      setSelectedGameRequest(null);
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] rejectGameRequest failed', e);
      Toast.show({ type: 'error', text1: 'Reject failed' });
    }
  };

  const handleSaveTeam = async () => {
    if (!teamData?.id || !user?.uid) return;
    setSaving(true);
    try {
      // Verify coordinator status server-side via Firestore rules — just attempt the write
      await updateDocNative('teams', teamData.id, {
        teamName: teamData.teamName,
        location: teamData.location ?? '',
        latitude: teamData.latitude ?? null,
        longitude: teamData.longitude ?? null,
        homeColor: teamData.homeColor ?? '#0a7ea4',
        awayColor: teamData.awayColor ?? '#ffffff',
      });

      // Propagate teamName to pending requests
      const reqSnap = await firestore()
        .collection('requests')
        .where('teamId', '==', teamData.id)
        .get();
      if (!reqSnap.empty) {
        await runBatch(
          reqSnap.docs.map((d) => ({ op: 'update' as const, col: 'requests', id: d.id, data: { teamName: teamData.teamName } }))
        );
      }

      Toast.show({ type: 'success', text1: 'Team updated' });
      setEditing(false);
      try { emitAppEvent('team:updated', { teamId: teamData.id, teamName: teamData.teamName }); } catch {}
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      if (code === 'firestore/permission-denied') {
        Toast.show({ type: 'error', text1: 'Permission denied', text2: 'Only coordinators can update this team.' });
      } else {
        Toast.show({ type: 'error', text1: 'Save failed' });
      }
      console.error('[CoordinatorDashboard] handleSaveTeam failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (originalTeamRef.current) setTeamData(originalTeamRef.current);
    setEditing(false);
  };

  const handleApproveCoordinatorRequest = async (request: CoordinatorRequest) => {
    try {
      await updateDocNative('users', request.userId, { isCoordinator: true, teamId: request.teamId });
      await updateDocNative('requests', request.id, { status: 'approved' });

      // Delete other pending requests for this team
      const snap = await firestore()
        .collection('requests')
        .where('teamId', '==', request.teamId)
        .where('status', '==', 'pending')
        .get();
      const others = snap.docs.filter((d) => d.id !== request.id);
      if (others.length) {
        await runBatch(others.map((d) => ({ op: 'delete' as const, col: 'requests', id: d.id })));
      }

      Toast.show({ type: 'success', text1: 'Coordinator Approved', text2: `${request.userEmail} is now a coordinator.` });
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] approveCoordinatorRequest failed', e);
      Toast.show({ type: 'error', text1: 'Error approving request' });
    }
  };

  const handleRejectCoordinatorRequest = async (id: string) => {
    try {
      await updateDocNative('requests', id, { status: 'rejected' });
      setRequests((prev) => prev.filter((r) => r.id !== id));
      Toast.show({ type: 'info', text1: 'Request Rejected' });
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] rejectCoordinatorRequest failed', e);
      Toast.show({ type: 'error', text1: 'Error rejecting request' });
    }
  };

  const handleDeleteGame = async (id: string) => {
    try {
      await deleteDocNative('games', id);
      Toast.show({ type: 'info', text1: 'Game removed' });
      setGames((prev) => prev.filter((g) => (g as { id: string }).id !== id));
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] deleteGame failed', e);
      Toast.show({ type: 'error', text1: 'Delete failed' });
    }
  };

  const handleLeaveTeam = async () => {
    if (!user?.uid || !teamData?.id) return;
    try {
      const coordSnap = await firestore()
        .collection('users')
        .where('teamId', '==', teamData.id)
        .where('isCoordinator', '==', true)
        .get();

      if (coordSnap.size <= 1) {
        Toast.show({ type: 'info', text1: 'Cannot leave', text2: 'You are the last coordinator — delete the team instead.' });
        return;
      }

      Alert.alert(
        'Leave Team',
        'Are you sure? You will lose coordinator privileges.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: async () => {
              try {
                await updateDocNative('users', user.uid, { teamId: '', isCoordinator: false });
                Toast.show({ type: 'success', text1: 'You left the team' });
                router.replace('/(tabs)');
              } catch (e: unknown) {
                console.error('[CoordinatorDashboard] leaveTeam failed', e);
                Toast.show({ type: 'error', text1: 'Leave failed' });
              }
            },
          },
        ],
        { cancelable: true }
      );
    } catch (e: unknown) {
      console.error('[CoordinatorDashboard] handleLeaveTeam failed', e);
      Toast.show({ type: 'error', text1: 'Action failed' });
    }
  };

  const handleDeleteTeam = async () => {
    if (!user?.uid || !teamData?.id) return;
    const nowMs = Date.now();
    const outstandingCount = games.filter((g) => {
      const t = new Date(String((g as Record<string, unknown>).startISO ?? '')).getTime();
      return !isNaN(t) && t > nowMs;
    }).length;

    const warningMsg = outstandingCount > 0
      ? `\n\nIncludes ${outstandingCount} upcoming game(s) that will also be deleted.`
      : '';

    Alert.alert(
      'Delete Team',
      `This permanently deletes the team, all games, and all requests. This cannot be undone.${warningMsg}\n\nContinue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const ops: Array<{ op: 'update' | 'delete'; col: string; id: string; data?: Record<string, unknown> }> = [];
              games.forEach((g) => { if ((g as { id: string }).id) ops.push({ op: 'delete', col: 'games', id: (g as { id: string }).id }); });
              requests.forEach((r) => { if (r.id) ops.push({ op: 'delete', col: 'requests', id: r.id }); });
              ops.push({ op: 'update', col: 'users', id: user.uid, data: { teamId: '', isCoordinator: false } });
              ops.push({ op: 'delete', col: 'teams', id: teamData.id });
              await runBatch(ops);

              Toast.show({ type: 'success', text1: 'Team deleted' });
              try { emitAppEvent('team:deleted', { teamId: teamData.id }); } catch {}
              router.replace('/(tabs)');
            } catch (e: unknown) {
              console.error('[CoordinatorDashboard] deleteTeam failed', e);
              Toast.show({ type: 'error', text1: 'Delete failed' });
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const Jersey = ({ color, label, onPress }: { color: string; label: string; onPress?: () => void }) => (
    <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.8 : 1} style={styles.jerseyTouchable}>
      <View style={styles.jerseyCard}>
        <View style={styles.jerseyBox}>
          <ExpoImage source={require('@/assets/images/jersey_fill.png')} style={[styles.jerseyImg, { tintColor: color }]} contentFit="contain" />
          <ExpoImage source={require('@/assets/images/jersey_outline.png')} style={styles.jerseyImg} contentFit="contain" />
        </View>
        <Text style={styles.jerseyLabel}>{label}</Text>
      </View>
    </TouchableOpacity>
  );

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  if (!teamData?.id) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No team data available. Create or join a team.</Text>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(tabs)/CreateTeamScreen')}>
          <Text style={styles.buttonText}>Create Team</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.secondaryButton]} onPress={() => router.push('/(tabs)/FindATeam')}>
          <Text style={styles.buttonText}>Find a Team</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const PlacesComp = placesComponent;

  const sections: Array<{ key: string; title: string; data: DashboardItem[] }> = [
    { key: 'requests', title: 'Pending Coordinator Requests', data: requests as DashboardItem[] },
    { key: 'gameRequests', title: 'Game Requests', data: gameRequests as DashboardItem[] },
    { key: 'games', title: 'Created Game Events', data: games as DashboardItem[] },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Modal visible={!!activePicker} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color</Text>
          <ColorPicker
            color={activePicker === 'home' ? (teamData.homeColor ?? '#0a7ea4') : (teamData.awayColor ?? '#ffffff')}
            onColorChangeComplete={(color: string) => {
              setTeamData((prev) => prev ? { ...prev, [activePicker === 'home' ? 'homeColor' : 'awayColor']: color } : prev);
            }}
            thumbSize={30}
            sliderSize={30}
            noSnap
            row={false}
            swatches
          />
          <TouchableOpacity style={styles.actionButton} onPress={() => setActivePicker(null)}>
            <Text style={styles.buttonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={requestModalVisible} animationType="slide" onRequestClose={() => { setRequestModalVisible(false); setSelectedGameRequest(null); }}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Game Request</Text>
          {selectedGameRequest ? (
            <>
              <Text style={styles.modalGameTitle}>{selectedGameRequest.title ?? 'Game'}</Text>
              <Text>Requesting Team: {selectedGameRequest.requestingTeamName ?? 'Unknown'}</Text>
              <Text>Requester: {selectedGameRequest.requestedByName ?? selectedGameRequest.requestedBy ?? 'Unknown'}</Text>
              <Text>Type: {(selectedGameRequest.type ?? 'home').toUpperCase()}</Text>
              <Text>Kit Color: {selectedGameRequest.kitColor ?? 'n/a'}</Text>
              <Text>Time: {selectedGameRequest.startISO ? new Date(selectedGameRequest.startISO).toLocaleString() : 'n/a'}</Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.actionButton, { flex: 1 }]} onPress={() => handleApproveGameRequest(selectedGameRequest)}>
                  <Text style={styles.buttonText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, styles.dangerButton, { flex: 1 }]} onPress={() => handleRejectGameRequest(selectedGameRequest.id)}>
                  <Text style={styles.buttonText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, styles.secondaryButton, { flex: 1 }]} onPress={() => { setRequestModalVisible(false); setSelectedGameRequest(null); }}>
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text>No request selected</Text>
          )}
        </View>
      </Modal>

      <SectionList
        sections={sections}
        keyExtractor={(item, index) => ((item as { id?: string })?.id ? String((item as { id: string }).id) : `${index}`)}
        contentContainerStyle={styles.container}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={() => (
          <>
            <Text style={styles.title}>Coordinator Dashboard</Text>

            {ratingHistory.length > 1 && (
              <View style={styles.chartContainer}>
                <Text style={styles.chartTitle}>Rating History</Text>
                <LineChart
                  data={{
                    labels: ratingHistory.map((_, i) => (i === 0 ? 'Start' : String(i))),
                    datasets: [{ data: ratingHistory.map((d) => d.y) }],
                  }}
                  width={Dimensions.get('window').width - 40}
                  height={220}
                  chartConfig={{
                    backgroundColor: '#ffffff',
                    backgroundGradientFrom: '#f9f9f9',
                    backgroundGradientTo: '#f9f9f9',
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(10, 126, 164, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
                    propsForDots: { r: '4', strokeWidth: '2', stroke: '#0a7ea4' },
                  }}
                  bezier
                  style={styles.chart}
                />
                <Text style={styles.chartSubtext}>
                  Current: {Math.round(teamData?.elo ?? 1500)} | Games: {ratingHistory.length - 1}
                </Text>
              </View>
            )}

            <View style={styles.buttonRow}>
              {!editing ? (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => { originalTeamRef.current = { ...teamData }; setEditing(true); }}
                >
                  <Text style={styles.buttonText}>Edit Team</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={[styles.actionButton, saving && styles.buttonDisabled]} onPress={handleSaveTeam} disabled={saving}>
                    <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={handleCancelEdit}>
                    <Text style={styles.buttonText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.actionButton, styles.successButton]} onPress={() => router.push('/(tabs)/GameResultsScreen')}>
                <Text style={styles.buttonText}>Game Results</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.warningButton]} onPress={handleLeaveTeam}>
                <Text style={styles.buttonText}>Leave Team</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={handleDeleteTeam}>
                <Text style={styles.buttonText}>Delete Team</Text>
              </TouchableOpacity>
            </View>

            {editing ? (
              <TextInput
                style={styles.input}
                value={teamData.teamName}
                onChangeText={(text) => setTeamData((prev) => prev ? { ...prev, teamName: text } : prev)}
                placeholder="Team Name"
              />
            ) : (
              <>
                <Text style={styles.readOnlyText}>{teamData.teamName}</Text>
                <Text style={[styles.readOnlyText, styles.ratingText]}>
                  Rating: {Math.min(Math.max(teamData?.elo ?? 1500, 800), 3000)}
                </Text>
              </>
            )}

            {editing ? (
              PlacesComp && GOOGLE_MAPS_API_KEY ? (
                <PlacesErrorBoundary onError={() => setPlacesComponent(null)}>
                  <PlacesComp
                    ref={autocompleteRef}
                    placeholder="Search ice rink..."
                    fetchDetails
                    debounce={400}
                    nearbyPlacesAPI="GooglePlacesSearch"
                    onPress={(data: { description: string }, details: { geometry: { location: { lat: number; lng: number } } } | null) => {
                      const lat = details?.geometry?.location?.lat ?? 0;
                      const lng = details?.geometry?.location?.lng ?? 0;
                      setTeamData((prev) => prev ? { ...prev, location: data.description, latitude: lat, longitude: lng } : prev);
                    }}
                    query={{ key: GOOGLE_MAPS_API_KEY, language: 'en', types: 'establishment' }}
                    styles={{ textInput: styles.input, container: styles.placesContainer }}
                  />
                </PlacesErrorBoundary>
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="Location (rink or arena)"
                  value={teamData?.location ?? ''}
                  onChangeText={(t) => setTeamData((prev) => prev ? { ...prev, location: t } : prev)}
                />
              )
            ) : (
              <Text style={styles.readOnlyText}>{teamData?.location ?? 'No location set'}</Text>
            )}

            <View style={styles.kitRow}>
              <Jersey color={teamData.homeColor ?? '#0a7ea4'} label="Home" {...(editing ? { onPress: () => setActivePicker('home') } : {})} />
              <Jersey color={teamData.awayColor ?? '#ffffff'} label="Away" {...(editing ? { onPress: () => setActivePicker('away') } : {})} />
            </View>
          </>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.subtitle}>{section.title}</Text>
            {section.key === 'gameRequests' && (
              <TouchableOpacity style={styles.smallButton} onPress={() => router.push('/(tabs)/GameSchedulerScreen')}>
                <Text style={styles.buttonText}>Open Scheduler</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        renderItem={({ item, section }) => {
          if (!item) return null;

          if (section.key === 'requests') {
            const req = item as CoordinatorRequest;
            return (
              <View style={styles.requestCard}>
                <Text style={styles.requestEmail}>{req.userEmail}</Text>
                <View style={styles.requestButtons}>
                  <TouchableOpacity style={[styles.actionButton, { flex: 1 }]} onPress={() => handleApproveCoordinatorRequest(req)}>
                    <Text style={styles.buttonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, styles.dangerButton, { flex: 1 }]} onPress={() => handleRejectCoordinatorRequest(req.id)}>
                    <Text style={styles.buttonText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          if (section.key === 'gameRequests') {
            const req = item as GameRequest;
            return (
              <TouchableOpacity style={styles.requestCard} onPress={() => { setSelectedGameRequest(req); setRequestModalVisible(true); }}>
                <Text style={styles.cardTitle}>Game Request — {req.requestingTeamName ?? req.requestingTeamId ?? 'Unknown'}</Text>
                <Text style={styles.cardSubtitle}>
                  {req.startISO ? new Date(req.startISO).toLocaleString() : 'No time'} • {(req.type ?? 'home').toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          }

          if (section.key === 'games') {
            const game = item as unknown as Record<string, unknown>;
            return (
              <View style={styles.requestCard}>
                <Text style={styles.cardTitle}>{String(game.title ?? 'Game')} — {String(game.type ?? '').toUpperCase() || 'N/A'}</Text>
                <Text>{game.startISO ? new Date(String(game.startISO)).toLocaleString() : 'No time set'}</Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={() => game.id && handleDeleteGame(String(game.id))}>
                    <Text style={styles.buttonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          return null;
        }}
        renderSectionFooter={({ section }) => {
          if (!section?.data?.length) {
            if (section.key === 'requests') return <Text style={styles.emptySection}>No pending coordinator requests</Text>;
            if (section.key === 'gameRequests') return <Text style={styles.emptySection}>No game requests</Text>;
          }
          return null;
        }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 10, color: '#444' },
  emptyText: { fontSize: 16, color: '#444', textAlign: 'center', marginBottom: 16 },
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: '#0a7ea4' },
  subtitle: { fontSize: 18, fontWeight: '600', marginVertical: 12, color: '#0a7ea4' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 10, borderRadius: 6 },
  readOnlyText: { borderWidth: 1, borderColor: '#ddd', padding: 10, marginBottom: 10, borderRadius: 6, backgroundColor: '#f9f9f9', color: '#333', fontSize: 16 },
  ratingText: { marginTop: 4, fontSize: 14 },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyTouchable: { opacity: 1 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  actionButton: { backgroundColor: '#0a7ea4', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', marginHorizontal: 4, marginVertical: 4 },
  smallButton: { backgroundColor: '#0a7ea4', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center' },
  dangerButton: { backgroundColor: '#FF3B30' },
  warningButton: { backgroundColor: '#FF9500' },
  successButton: { backgroundColor: '#4CAF50' },
  secondaryButton: { backgroundColor: '#444' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  requestCard: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, marginBottom: 10 },
  requestEmail: { fontSize: 16, fontWeight: '500', marginBottom: 10 },
  requestButtons: { flexDirection: 'row', gap: 8 },
  cardTitle: { fontWeight: '700', fontSize: 15, marginBottom: 4 },
  cardSubtitle: { color: '#444' },
  cardActions: { flexDirection: 'row', marginTop: 8 },
  emptySection: { textAlign: 'center', color: '#666', paddingVertical: 8 },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  modalGameTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  placesContainer: { marginBottom: 10 },
  chartContainer: { marginBottom: 20, paddingVertical: 16, paddingHorizontal: 8, backgroundColor: '#f9f9f9', borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  chartTitle: { fontSize: 18, fontWeight: '700', color: '#0a7ea4', marginBottom: 8, textAlign: 'center' },
  chartSubtext: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 8 },
  chart: { marginVertical: 8, borderRadius: 16 },
});
