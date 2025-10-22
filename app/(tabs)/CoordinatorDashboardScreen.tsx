// app/(tabs)/CoordinatorDashboardScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
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
import { getDocument, runCollectionQuery } from '../../src/firestoreRest';

// Read API key from app config or env
const GOOGLE_MAPS_API_KEY =
  Constants.expoConfig?.extra?.googleMapsApiKey ??
  (process.env.GOOGLE_MAPS_API_KEY as string) ??
  '';

// --- Safe write helpers (work for native @react-native-firebase and web modular SDK) ---
async function addDocSafe(collectionPath: string, data: any) {
  if (db && typeof (db as any).collection === 'function') {
    // native RN Firebase
    return (db as any).collection(collectionPath).add(data);
  } else {
    const { collection, addDoc } = await import('firebase/firestore');
    return addDoc(collection(db as any, collectionPath), data);
  }
}

async function updateDocSafe(path: string, data: any) {
  const parts = path.split('/');
  const col = parts[0];
  const id = parts[1];
  if (!col || !id) throw new Error('updateDocSafe expects "collection/docId" path');

  if (db && typeof (db as any).collection === 'function') {
    return (db as any).collection(col).doc(id).update(data);
  } else {
    const { doc, updateDoc } = await import('firebase/firestore');
    return updateDoc(doc(db as any, col, id), data);
  }
}

async function deleteDocSafe(path: string) {
  const parts = path.split('/');
  const col = parts[0];
  const id = parts[1];
  if (!col || !id) throw new Error('deleteDocSafe expects "collection/docId" path');

  if (db && typeof (db as any).collection === 'function') {
    return (db as any).collection(col).doc(id).delete();
  } else {
    const { doc, deleteDoc } = await import('firebase/firestore');
    return deleteDoc(doc(db as any, col, id));
  }
}

/**
 * Run a batch of updates/deletes. On web uses writeBatch for atomic commit;
 * on native it performs the operations sequentially (best-effort fallback).
 * ops: { op: 'update' | 'delete', path: 'collection/docId', data?: any }
 */
async function runBatchSafe(ops: Array<{ op: 'update' | 'delete'; path: string; data?: any }>) {
  if (db && typeof (db as any).collection === 'function') {
    // native: do sequential (no guaranteed atomicity)
    for (const o of ops) {
      try {
        if (o.op === 'update') await updateDocSafe(o.path, o.data);
        else if (o.op === 'delete') await deleteDocSafe(o.path);
      } catch (e) {
        // non-fatal for batch fallback; log and continue
        console.warn('[runBatchSafe] native op failed', o, e);
      }
    }
    return;
  } else {
    const { writeBatch, doc } = await import('firebase/firestore');
    const batch = writeBatch(db as any);
    for (const o of ops) {
      const [col, id] = o.path.split('/');
      if (o.op === 'update') batch.update(doc(db as any, col, id), o.data ?? {});
      else if (o.op === 'delete') batch.delete(doc(db as any, col, id));
    }
    await batch.commit();
  }
}
// --- end helpers ---

// Types
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

interface Request {
  id: string;
  userEmail: string;
  userId: string;
  teamId: string;
  status: string;
}

export default function CoordinatorDashboardScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [teamData, setTeamData] = useState<Team | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [placesComponent, setPlacesComponent] = useState<any>(null);
  const autocompleteRef = useRef<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const originalTeamRef = useRef<any>(null);

  // Error boundary for Places component
  class PlacesErrorBoundary extends React.Component<{ children: React.ReactNode; onError?: () => void }, { hasError: boolean }> {
    constructor(props: any) {
      super(props);
      this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
      return { hasError: true };
    }
    componentDidCatch(error: any, info: any) {
      console.warn('[PlacesErrorBoundary] caught error rendering PlacesComp', error, info);
      try { this.props.onError?.(); } catch (e) { /* ignore */ }
    }
    render() {
      if (this.state.hasError) {
        return null; // fall back to text input in parent
      }
      return this.props.children as any;
    }
  }

  // Dynamic loader for GooglePlacesAutocomplete
  useEffect(() => {
    let mounted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-google-places-autocomplete');
      // store the component type directly (not a wrapper)
      if (mounted) setPlacesComponent(mod?.GooglePlacesAutocomplete ?? mod ?? null);
    } catch (e) {
      if (__DEV__) console.warn('GooglePlacesAutocomplete not available:', e);
      if (mounted) setPlacesComponent(null);
    }
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      const currentUser = await waitForAuthUser(3000);
      console.log('[Coordinator] resolved currentUser before loading:', !!currentUser, currentUser?.uid ?? null);

      if (!currentUser) {
        // No signed-in user after waiting — navigate to login (or show message)
        router.replace('/(auth)/LoginScreen');
        return;
      }

      try {
        await ensureFirestoreOnline();

        // Read user via REST helper (avoids web streaming)
        const userDoc = await getDocument(`users/${currentUser.uid}`);
        if (!userDoc) {
          if (isMounted) {
            Toast.show({ type: 'error', text1: 'User record not found' });
            router.replace('/(tabs)');
          }
          return;
        }

        const userData = userDoc as any;
        if (!userData?.isCoordinator) {
          if (isMounted) {
            Toast.show({
              type: 'error',
              text1: 'Access Denied',
              text2: 'You must be a coordinator to access this page.',
            });
            router.replace('/(tabs)');
          }
          return;
        }

        // Read team via REST helper
        const teamId = userData.teamId;
        const teamDoc = await getDocument(`teams/${teamId}`);
        if (!teamDoc) {
          if (isMounted) {
            Toast.show({ type: 'error', text1: 'Team not found' });
            router.replace('/(tabs)');
          }
          return;
        }

        const team: Team = { id: teamDoc.id, ...(teamDoc as any) };
        if (isMounted) {
          setTeamData(team);

          if (team.latitude && team.longitude) {
            setLocationCoords({
              latitude: team.latitude,
              longitude: team.longitude,
            });
          }
        }

        // Fetch pending requests via REST and filter client-side
        const reqDocs = await runCollectionQuery({
          collectionId: 'requests',
          limit: 500,
        });
        const fetchedRequests: Request[] = reqDocs
          .filter((r: any) => r.teamId === team.id && r.status === 'pending')
          .map((r: any) => ({ id: r.id, ...r }));

        if (isMounted) setRequests(fetchedRequests);
      } catch (e) {
        console.error('❌ Error loading data:', e);
        if (isMounted) Toast.show({ type: 'error', text1: 'Error loading team data' });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [user, router]);

  // Fetch games for the current team (uses REST)
  const fetchGames = async (teamId?: string) => {
    if (!teamId) return setGames([]);
    try {
      await ensureFirestoreOnline();
      const docs = await runCollectionQuery({
        collectionId: 'games',
        // supply where/orderBy as arrays (helper expects arrays)
        where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamId }],
        orderBy: [{ fieldPath: 'startISO', direction: 'ASCENDING' }],
        limit: 500,
      });
      setGames(docs as any[]);
    } catch (err: any) {
      console.warn('Failed to load games', err);
      const msg = err?.message ?? '';
      const match = msg.match(/https?:\/\/[^\s)]+create_composite[^\s)]+/);
      if (match) {
        console.warn('Create composite index:', match[0]);
        Toast.show({
          type: 'error',
          text1: 'Firestore index required',
          text2: 'Open the console link printed in DevTools',
        });
      } else {
        Toast.show({ type: 'error', text1: 'Failed to load games' });
      }
      setGames([]);
    }
  };

  useEffect(() => {
    if (teamData?.id) fetchGames(teamData.id);
  }, [teamData?.id]);

  // --- Game request types + state ---
  interface GameRequest {
    id: string;
    teamId?: string;
    requestingTeamId?: string;
    requestingTeamName?: string;
    requestedBy?: string;
    requestedByName?: string;
    title?: string;
    startISO?: string;
    type?: 'home' | 'away';
    kitColor?: string;
    status?: string;
    createdAt?: string;
  }

  const [gameRequests, setGameRequests] = useState<GameRequest[]>([]);
  const [loadingGameRequests, setLoadingGameRequests] = useState(false);
  const [selectedGameRequest, setSelectedGameRequest] = useState<GameRequest | null>(null);
  const [requestModalVisible, setRequestModalVisible] = useState(false);

  // Fetch game requests for this team (REST)
  const fetchGameRequests = async (teamId?: string) => {
    if (!teamId) {
      setGameRequests([]);
      return;
    }
    setLoadingGameRequests(true);
    try {
      await ensureFirestoreOnline();
      const docs = await runCollectionQuery({
        collectionId: 'gameRequests',
        where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamId }],
        limit: 500,
      });
      const items: GameRequest[] = (docs as any[]).map((d) => ({ id: d.id, ...(d as any) }));
      setGameRequests(items);
    } catch (e: any) {
      console.warn('Failed to load game requests', e);
      setGameRequests([]);
    } finally {
      setLoadingGameRequests(false);
    }
  };

  useEffect(() => {
    if (teamData?.id) fetchGameRequests(teamData.id);
    else setGameRequests([]);
  }, [teamData?.id]);

  // Approve a game request: create a game from the request, mark request approved (or delete)
  const handleApproveGameRequest = async (req: GameRequest) => {
    if (!teamData?.id) return;
    try {
      await ensureFirestoreOnline();

      const payload: any = {
        teamId: teamData.id,
        title: req.title ?? 'Game Request',
        type: req.type ?? 'home',
        startISO: req.startISO ?? new Date().toISOString(),
        location: teamData.location ?? '',
        createdBy: req.requestedBy ?? user?.uid,
        createdAt: new Date().toISOString(),
      };
      if (req.kitColor) payload.kitColor = req.kitColor;

      // create the game (safe helper)
      await addDocSafe('games', payload);

      // mark request approved (or delete) using safe update/delete
      try {
        await updateDocSafe(`gameRequests/${req.id}`, { status: 'approved' });
      } catch {
        try {
          await deleteDocSafe(`gameRequests/${req.id}`);
        } catch (err) {
          console.warn('Failed to remove game request after approval', err);
        }
      }

      Toast.show({ type: 'success', text1: 'Game created', text2: `${req.requestingTeamName ?? 'Team'} — scheduled` });
      await fetchGames(teamData.id);
      await fetchGameRequests(teamData.id);
      setRequestModalVisible(false);
      setSelectedGameRequest(null);
    } catch (e: any) {
      console.error('Approve game request failed', e);
      Toast.show({ type: 'error', text1: 'Approve failed', text2: e?.message || '' });
    }
  };

  // Reject a game request: mark rejected or delete
  const handleRejectGameRequest = async (reqId: string) => {
    try {
      await ensureFirestoreOnline();
      try {
        await updateDocSafe(`gameRequests/${reqId}`, { status: 'rejected' });
      } catch {
        await deleteDocSafe(`gameRequests/${reqId}`);
      }
      Toast.show({ type: 'info', text1: 'Game request rejected' });
      if (teamData?.id) fetchGameRequests(teamData.id);
      setRequestModalVisible(false);
      setSelectedGameRequest(null);
    } catch (e: any) {
      console.error('Reject game request failed', e);
      Toast.show({ type: 'error', text1: 'Reject failed', text2: e?.message || '' });
    }
  };

  // Save team changes
  const handleSaveTeam = async () => {
    if (!teamData?.id) return;
    setSaving(true);
    try {
      // 1) update the team document
      await updateDocSafe(`teams/${teamData.id}`, {
        teamName: teamData.teamName,
        location: teamData.location ?? '',
        latitude: teamData.latitude ?? null,
        longitude: teamData.longitude ?? null,
        homeColor: teamData.homeColor ?? '#0a7ea4',
        awayColor: teamData.awayColor ?? '#ffffff',
      });

      // 2) propagate cached teamName to requests (so HomeScreen and other lists show updated name)
      try {
        const reqDocs = await runCollectionQuery({
          collectionId: 'requests',
          where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamData.id }],
          limit: 500,
        });

        if (reqDocs.length) {
          const ops = (reqDocs as any[]).map((r: any) => ({ op: 'update' as const, path: `requests/${r.id}`, data: { teamName: teamData.teamName } }));
          await runBatchSafe(ops);
        }
      } catch (propErr) {
        console.warn('Failed to update cached teamName in requests', propErr);
      }

      Toast.show({ type: 'success', text1: 'Team updated' });
      setEditing(false);
    } catch (err: any) {
      console.error('Failed to save team', err);
      Toast.show({ type: 'error', text1: 'Save failed', text2: err?.message || '' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (originalTeamRef.current) setTeamData(originalTeamRef.current);
    setEditing(false);
  };

  // Approve coordinator request
  const handleApprove = async (request: Request) => {
    try {
      await updateDocSafe(`users/${request.userId}`, { isCoordinator: true, teamId: request.teamId });
      await updateDocSafe(`requests/${request.id}`, { status: 'approved' });

      const snapDocs = await runCollectionQuery({
        collectionId: 'requests',
        where: [{ fieldPath: 'teamId', op: 'EQUAL', value: request.teamId }],
        limit: 500,
      });

      // delete other pending requests (safe delete)
      const deletes = (snapDocs as any[]).filter((r) => r.id !== request.id).map((r) => ({ op: 'delete' as const, path: `requests/${r.id}` }));
      if (deletes.length) await runBatchSafe(deletes);

      Toast.show({
        type: 'success',
        text1: 'Coordinator Approved',
        text2: `${request.userEmail} is now a coordinator.`,
      });
      setRequests((prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== request.id) : []));
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error approving request', text2: e.message });
    }
  };

  const handleReject = async (id: string) => {
    try {
      await updateDocSafe(`requests/${id}`, { status: 'rejected' });
      setRequests((prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== id) : []));
      Toast.show({ type: 'info', text1: 'Request Rejected' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error rejecting request', text2: e.message });
    }
  };

  const handleDeleteGame = async (id: string) => {
    try {
      await deleteDocSafe(`games/${id}`);
      Toast.show({ type: 'info', text1: 'Game removed' });
      setGames((prev) => (Array.isArray(prev) ? prev.filter((g) => g.id !== id) : []));
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Delete failed', text2: e?.message || '' });
    }
  };

  // Count coordinators by querying users for teamId
  const countCoordinators = async (teamId: string) => {
    const docs = await runCollectionQuery({
      collectionId: 'users',
      where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamId }],
      limit: 1000,
    });
    return docs.filter((d: any) => !!d.isCoordinator).length;
  };

  const handleLeaveTeam = async () => {
    if (!user?.uid || !teamData?.id) return;
    try {
      const coordCount = await countCoordinators(teamData.id);
      if (coordCount <= 1) {
        Toast.show({
          type: 'info',
          text1: 'Cannot leave',
          text2: 'You are the last coordinator — delete the team instead.',
        });
        return;
      }

      Alert.alert(
        'Leave Team',
        'Are you sure you want to leave this team as a coordinator? You will lose coordinator privileges.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: async () => {
              try {
                await ensureFirestoreOnline();
                await updateDocSafe(`users/${user.uid}`, { teamId: '', isCoordinator: false });
                Toast.show({ type: 'success', text1: 'You left the team' });
                router.replace('/(tabs)');
              } catch (e: any) {
                console.error('Leave failed', e);
                Toast.show({ type: 'error', text1: 'Leave failed', text2: e?.message || '' });
              }
            },
          },
        ],
        { cancelable: true }
      );
    } catch (e: any) {
      console.error('Count coordinators failed', e);
      Toast.show({ type: 'error', text1: 'Action failed', text2: e?.message || '' });
    }
  };

  // Delete team: destructive — removes team doc + games + requests, and clears teamId for users
  const handleDeleteTeam = async () => {
    if (!user?.uid || !teamData?.id) return;
    Alert.alert(
      'Delete Team',
      'This will permanently delete the team, its games and requests, and remove the team from member profiles. This action cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await ensureFirestoreOnline();

              // gather docs (use arrays for where)
              const gamesDocs = await runCollectionQuery({
                collectionId: 'games',
                where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamData.id }],
                limit: 1000,
              });
              const reqDocs = await runCollectionQuery({
                collectionId: 'requests',
                where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamData.id }],
                limit: 1000,
              });
              const usersDocs = await runCollectionQuery({
                collectionId: 'users',
                where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamData.id }],
                limit: 1000,
              });

              const ops: Array<{ op: 'update' | 'delete'; path: string; data?: any }> = [];

              gamesDocs.forEach((g: any) => ops.push({ op: 'delete', path: `games/${g.id}` }));
              reqDocs.forEach((r: any) => ops.push({ op: 'delete', path: `requests/${r.id}` }));
              usersDocs.forEach((u: any) => ops.push({ op: 'update', path: `users/${u.id}`, data: { teamId: '', isCoordinator: false } }));

              // finally delete the team doc
              ops.push({ op: 'delete', path: `teams/${teamData.id}` });

              await runBatchSafe(ops);

              Toast.show({ type: 'success', text1: 'Team deleted' });
              router.replace('/(tabs)/HomeScreen');
            } catch (e: any) {
              console.error('Delete team failed', e);
              Toast.show({ type: 'error', text1: 'Delete failed', text2: e?.message || '' });
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const PlacesComp: any = (placesComponent as any) ?? null;

  const Jersey = ({
    color,
    label,
    onPress,
  }: {
    color: string;
    label: string;
    onPress?: () => void;
  }) => {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={!onPress}
        activeOpacity={onPress ? 0.8 : 1}
        style={{ opacity: onPress ? 1 : 0.85 }}
      >
        <View style={styles.jerseyCard}>
          <View style={styles.jerseyBox}>
            <ExpoImage
              source={require('@/assets/images/jersey_fill.png')}
              style={[styles.jerseyImg, { tintColor: color }]}
              contentFit="contain"
            />
            <ExpoImage
              source={require('@/assets/images/jersey_outline.png')}
              style={styles.jerseyImg}
              contentFit="contain"
            />
          </View>
          <Text style={styles.jerseyLabel}>{label}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={{ marginTop: 10 }}>Loading dashboard...</Text>
      </View>
    );
  }

  if (!user) {
    router.replace('/(auth)/LoginScreen');
    return null;
  }

  if (!teamData?.id) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 18, color: '#444', textAlign: 'center', marginBottom: 12 }}>
          No team data available. Create or join a team to manage it.
        </Text>
        <Button title="Create Team" onPress={() => router.push('/(tabs)/CreateTeamScreen')} />
        <View style={{ height: 8 }} />
        <Button title="Find a Team" onPress={() => router.push('/(tabs)/FindATeam')} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
    >
      <Text style={styles.title}>Coordinator Dashboard</Text>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
        {!editing ? (
          <Button
            title="Edit Team"
            onPress={() => {
              originalTeamRef.current = { ...(teamData || {}) };
              setEditing(true);
            }}
            color="#0a7ea4"
          />
        ) : (
          <>
            <Button title={saving ? 'Saving...' : 'Save'} onPress={handleSaveTeam} disabled={saving} color="#0a7ea4" />
            <View style={{ width: 10 }} />
            <Button title="Cancel" onPress={handleCancelEdit} color="#FF3B30" />
          </>
        )}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
        <Button title="Leave Team" onPress={handleLeaveTeam} color="#FF9500" />
        <Button title="Delete Team" onPress={handleDeleteTeam} color="#FF3B30" />
      </View>

      {editing ? (
        <TextInput
          style={styles.input}
          value={teamData.teamName}
          onChangeText={(text) => setTeamData({ ...teamData, teamName: text })}
          editable
          placeholder="Team Name"
        />
      ) : (
        <>
          <Text style={styles.readOnlyText}>{teamData.teamName}</Text>
          <Text style={[styles.readOnlyText, { marginTop: 6, fontSize: 14 }]}>
            Rating: {Math.min(Math.max(teamData?.elo ?? 1500, 800), 3000)}
          </Text>
        </>
      )}

      {editing ? (
        // Location: editable only when editing
        PlacesComp ? (
          // Wrap in boundary so if the third-party component throws we don't crash the whole screen
          <PlacesErrorBoundary onError={() => setPlacesComponent(null)}>
            <PlacesComp
              ref={autocompleteRef}
              placeholder="Search ice rink..."
              fetchDetails
              onPress={(data: any, details: any = null) => {
                const lat = details?.geometry?.location?.lat ?? 0;
                const lng = details?.geometry?.location?.lng ?? 0;
                setTeamData({ ...teamData, location: data.description, latitude: lat, longitude: lng });
              }}
              query={{
                ...(GOOGLE_MAPS_API_KEY ? { key: GOOGLE_MAPS_API_KEY } : {}),
                language: 'en',
                // `types` historically supported; new APIs may require `type` or different query config.
                // Keep it conservative so the component can decide. If you see warnings, try removing `types`.
                types: 'establishment',
              }}
              styles={{ textInput: styles.input, container: { marginBottom: 10 } }}
            />
          </PlacesErrorBoundary>
        ) : (
          <TextInput
            style={styles.input}
            placeholder="Location (rink or arena)"
            value={teamData?.location ?? ''}
            onChangeText={(t) => setTeamData({ ...teamData, location: t })}
          />
        )
      ) : (
        <Text style={styles.readOnlyText}>{teamData?.location ?? 'No location set'}</Text>
      )}

      <View style={styles.kitRow}>
        <Jersey
          color={teamData.homeColor ?? '#0a7ea4'}
          label="Home"
          onPress={editing ? () => setActivePicker('home') : undefined}
        />
        <Jersey
          color={teamData.awayColor ?? '#ffffff'}
          label="Away"
          onPress={editing ? () => setActivePicker('away') : undefined}
        />
      </View>

      <Modal visible={!!activePicker} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>
            Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color
          </Text>
          <ColorPicker
            color={
              activePicker === 'home'
                ? teamData.homeColor ?? '#0a7ea4'
                : teamData.awayColor ?? '#ffffff'
            }
            onColorChangeComplete={(color: string) => {
              if (activePicker === 'home')
                setTeamData({ ...teamData, homeColor: color });
              else setTeamData({ ...teamData, awayColor: color });
            }}
            thumbSize={30}
            sliderSize={30}
            noSnap
            row={false}
            swatches
          />
          <Button title="Done" onPress={() => setActivePicker(null)} />
        </View>
      </Modal>

      <Text style={styles.subtitle}>Pending Coordinator Requests</Text>
      <View style={styles.listPanel}>
        {requests.length === 0 ? (
          <Text style={styles.noRequests}>No pending requests</Text>
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(item) => item.id}
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => (
              <View style={styles.requestCard}>
                <Text style={styles.requestEmail}>{item.userEmail}</Text>
                <View style={styles.requestButtons}>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#0a7ea4' }]}
                    onPress={() => handleApprove(item)}
                  >
                    <Text style={styles.buttonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FF3B30' }]}
                    onPress={() => handleReject(item.id)}
                  >
                    <Text style={styles.buttonText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <Text style={styles.subtitle}>Game Requests</Text>
        <Button
          title="Open Scheduler"
          onPress={() => router.push('/(tabs)/GameSchedulerScreen')}
          color="#0a7ea4"
        />
      </View>

      <View style={styles.listPanel}>
        {loadingGameRequests ? (
          <ActivityIndicator size="small" color="#0a7ea4" />
        ) : gameRequests.length === 0 ? (
          <Text style={styles.noRequests}>No game requests</Text>
        ) : (
          <FlatList
            data={gameRequests}
            keyExtractor={(item) => item.id}
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => {
              if (!item) return null;
              const dtText = item.startISO ? new Date(item.startISO).toLocaleString() : 'No time';
              const requesting = item.requestingTeamName ?? item.requestingTeamId ?? 'Unknown Team';
              return (
                <TouchableOpacity
                  style={styles.requestCard}
                  onPress={() => {
                    setSelectedGameRequest(item);
                    setRequestModalVisible(true);
                  }}
                >
                  <Text style={{ fontWeight: '700' }}>Game Request — {requesting}</Text>
                  <Text style={{ color: '#444' }}>{dtText} • { (item.type ?? 'home').toUpperCase() }</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      <Modal visible={requestModalVisible} animationType="slide" onRequestClose={() => { setRequestModalVisible(false); setSelectedGameRequest(null); }}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Game Request</Text>
          {selectedGameRequest ? (
            <>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>{selectedGameRequest.title ?? 'Game'}</Text>
              <Text>Requesting Team: {selectedGameRequest.requestingTeamName ?? 'Unknown'}</Text>
              <Text>Requester: {selectedGameRequest.requestedByName ?? selectedGameRequest.requestedBy ?? 'Unknown'}</Text>
              <Text>Type: {(selectedGameRequest.type ?? 'home').toUpperCase()}</Text>
              <Text>Kit Color: {selectedGameRequest.kitColor ?? 'n/a'}</Text>
              <Text>Time: {selectedGameRequest.startISO ? new Date(selectedGameRequest.startISO).toLocaleString() : 'n/a'}</Text>

              <View style={{ height: 12 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Button title="Approve" color="#0a7ea4" onPress={() => selectedGameRequest && handleApproveGameRequest(selectedGameRequest)} />
                <Button title="Reject" color="#FF3B30" onPress={() => selectedGameRequest && handleRejectGameRequest(selectedGameRequest.id)} />
                <Button title="Close" color="#999" onPress={() => { setRequestModalVisible(false); setSelectedGameRequest(null); }} />
              </View>
            </>
          ) : (
            <Text>No request selected</Text>
          )}
        </View>
      </Modal>

      <Text style={styles.subtitle}>Games / Availability</Text>

      <View style={styles.listPanel}>
        {games.length === 0 ? (
          <Text style={styles.noRequests}>No scheduled games</Text>
        ) : (
          <FlatList
            data={games}
            keyExtractor={(item) => item.id}
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => {
              if (!item) return null;

              const dt = item?.startISO ? new Date(item.startISO) : null;
              const title = item?.title ?? 'Game';
              const typeLabel = (item?.type ?? '').toString().toUpperCase() || 'N/A';
              const recurringFreq = item?.recurring?.freq ?? null;

              return (
                <View style={styles.requestCard}>
                  <Text style={{ fontWeight: '600' }}>{title} — {typeLabel}</Text>
                  <Text>{dt ? dt.toLocaleString() : 'No time set'}</Text>
                  {recurringFreq ? <Text style={{ color: '#666' }}>Recurring: {String(recurringFreq)}</Text> : null}
                  <View style={{ flexDirection: 'row', marginTop: 8 }}>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: '#FF3B30' }]}
                      onPress={() => item?.id && handleDeleteGame(item.id)}
                    >
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#0a7ea4',
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    marginVertical: 15,
    color: '#0a7ea4',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
  },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  requestCard: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  requestEmail: { fontSize: 16, fontWeight: '500', marginBottom: 10 },
  requestButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  actionButton: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600' },
  noRequests: { textAlign: 'center', color: '#999', fontSize: 16 },
  readOnlyText: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
    backgroundColor: '#f9f9f9',
    color: '#333',
    fontSize: 16,
  },
  listPanel: {
    maxHeight: 220,
    marginBottom: 12,
  },
});

// --- place this inside CoordinatorDashboardScreen, just after originalTeamRef declaration ---
async function waitForAuthUser(timeoutMs = 3000): Promise<any | null> {
  const a = auth as any;
  if (!a) return null;

  // fast-path
  if (a.currentUser) return a.currentUser;

  return new Promise((resolve) => {
    let done = false;
    const finish = (u: any) => {
      if (!done) {
        done = true;
        resolve(u ?? null);
      }
    };

    try {
      // Native SDK: auth.onAuthStateChanged exists on the auth object
      if (typeof a.onAuthStateChanged === 'function') {
        const unsub = a.onAuthStateChanged((u: any) => {
          finish(u);
          try { unsub(); } catch {}
        });
        // guaranteed timeout fallback
        setTimeout(() => { finish(a.currentUser ?? null); try { unsub(); } catch {} }, timeoutMs);
        return;
      }

      // Web modular: import onAuthStateChanged and subscribe
      import('firebase/auth')
        .then(({ onAuthStateChanged }) => {
          try {
            const unsub = onAuthStateChanged(a, (u: any) => {
              finish(u);
              try { unsub(); } catch {}
            });
            setTimeout(() => { finish(a.currentUser ?? null); try { unsub(); } catch {} }, timeoutMs);
          } catch {
            finish(a.currentUser ?? null);
          }
        })
        .catch(() => finish(a.currentUser ?? null));
    } catch {
      finish(a.currentUser ?? null);
    }
  });
}
