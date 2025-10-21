// app/(tabs)/CoordinatorDashboardScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
// removed static import to avoid bundler crashes; will require at runtime if available
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

// ✅ Define types
interface Team {
  id: string;
  teamName?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeColor?: string;
  awayColor?: string;
}

interface Request {
  id: string;
  userEmail: string;
  userId: string;
  teamId: string;
  status: string;
}

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

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
  const [creatingGame, setCreatingGame] = useState(false);
  const [newGameTitle, setNewGameTitle] = useState('Game');
  const [newGameDate, setNewGameDate] = useState(''); // YYYY-MM-DD
  const [newGameTime, setNewGameTime] = useState('20:00'); // HH:MM
  const [newGameType, setNewGameType] = useState<'home' | 'away'>('home');
  const [newGameRecurring, setNewGameRecurring] = useState<'none' | 'monthly'>('monthly');
  const [saving, setSaving] = useState(false);

  // ✅ Load team and coordinator data safely
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!user) {
        router.replace('/(auth)/LoginScreen');
        return;
      }

      try {
        await ensureFirestoreOnline();

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          if (isMounted) {
            Toast.show({ type: 'error', text1: 'User record not found' });
            router.replace('/(tabs)/HomeScreen');
          }
          return;
        }
    
        const userData = userSnap.data();
        if (!userData?.isCoordinator) {
          if (isMounted) {
            Toast.show({
              type: 'error',
              text1: 'Access Denied',
              text2: 'You must be a coordinator to access this page.',
            });
            router.replace('/(tabs)/HomeScreen');
          }
          return;
        }
    
        const teamRef = doc(db, 'teams', userData.teamId);
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists()) {
          if (isMounted) {
            Toast.show({ type: 'error', text1: 'Team not found' });
            router.replace('/(tabs)/HomeScreen');
          }
          return;
        }

        const team: Team = { id: teamRef.id, ...(teamSnap.data() as Omit<Team, 'id'>) };
        if (isMounted) {
          setTeamData(team);

          if (team.latitude && team.longitude) {
            setLocationCoords({
              latitude: team.latitude,
              longitude: team.longitude,
            });
          }
        }

        // ✅ Fetch pending requests safely
        const q = query(
          collection(db, 'requests'),
          where('teamId', '==', teamRef.id),
          where('status', '==', 'pending')
        );
        const reqSnap = await getDocs(q);
        const fetchedRequests: Request[] = [];
        reqSnap.forEach((r) => {
          const data = r.data() as Omit<Request, 'id'>;
          fetchedRequests.push({ id: r.id, ...data });
        });

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
  }, [user]);

  // Fetch games for the current team
  const fetchGames = async (teamId?: string) => {
    if (!teamId) return setGames([]);
    try {
      const q = query(
        collection(db, 'games'),
        where('teamId', '==', teamId),
        orderBy('startISO', 'asc')
      );
      const snap = await getDocs(q);
      const items: any[] = [];
      snap.forEach((s) => items.push({ id: s.id, ...(s.data() as any) }));
      setGames(items);
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

  // call fetchGames after teamData loads
  useEffect(() => {
    if (teamData?.id) fetchGames(teamData.id);
  }, [teamData?.id]);

  // ✅ Save team changes
  const handleSaveTeam = async () => {
    if (!teamData?.id) return;
    setSaving(true);
    const teamRef = doc(db, 'teams', teamData.id);

    try {
      // 1) update the team document
      await updateDoc(teamRef, {
        teamName: teamData.teamName,
        location: teamData.location ?? '',
        latitude: teamData.latitude ?? null,
        longitude: teamData.longitude ?? null,
        homeColor: teamData.homeColor ?? '#0a7ea4',
        awayColor: teamData.awayColor ?? '#ffffff',
      });

      // 2) propagate cached teamName to requests (so HomeScreen and other lists show updated name)
      try {
        const reqQ = query(collection(db, 'requests'), where('teamId', '==', teamData.id));
        const reqSnap = await getDocs(reqQ);
        if (!reqSnap.empty) {
          const batch = writeBatch(db);
          reqSnap.forEach((r) => {
            batch.update(doc(db, 'requests', r.id), { teamName: teamData.teamName });
          });
          await batch.commit();
        }
      } catch (propErr) {
        console.warn('Failed to update cached teamName in requests', propErr);
        // Non-fatal — team doc already saved
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

  // ✅ Approve coordinator request
  const handleApprove = async (request: Request) => {
    try {
      const userRef = doc(db, 'users', request.userId);
      await updateDoc(userRef, { isCoordinator: true, teamId: request.teamId });

      const requestRef = doc(db, 'requests', request.id);
      await updateDoc(requestRef, { status: 'approved' });

      // Remove other pending requests for same team
      const q = query(
        collection(db, 'requests'),
        where('teamId', '==', request.teamId),
        where('status', '==', 'pending')
      );
      const snap = await getDocs(q);
      snap.forEach(async (docSnap) => {
        if (docSnap.id !== request.id) await deleteDoc(docSnap.ref);
      });

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
      const requestRef = doc(db, 'requests', id);
      await updateDoc(requestRef, { status: 'rejected' });
      setRequests((prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== id) : []));
      Toast.show({ type: 'info', text1: 'Request Rejected' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error rejecting request', text2: e.message });
    }
  };

  // create a single or recurring game document
  const handleCreateGame = async () => {
    if (!teamData?.id || !user?.uid) {
      Toast.show({ type: 'error', text1: 'Missing team or user' });
      return;
    }
    if (!newGameDate || !newGameTime) {
      Toast.show({ type: 'error', text1: 'Enter date and time' });
      return;
    }

    setCreatingGame(true);
    try {
      // parse date/time locally (assume local timezone)
      const [y, m, d] = newGameDate.split('-').map(Number);
      const [hh, mm] = newGameTime.split(':').map(Number);
      const dt = new Date(y, (m || 1) - 1, d, hh || 20, mm || 0, 0);
      const payload: any = {
        teamId: teamData.id,
        title: newGameTitle || 'Game',
        type: newGameType,
        startISO: dt.toISOString(),
        location: teamData.location ?? '',
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      };

      if (newGameRecurring === 'monthly') {
        payload.recurring = { freq: 'monthly', dayOfMonth: dt.getDate() };
      }

      await addDoc(collection(db, 'games'), payload);
      Toast.show({ type: 'success', text1: 'Game created' });
      // refresh list
      await fetchGames(teamData.id);
      // reset minimal fields
      setNewGameTitle('Game');
      setNewGameDate('');
      setNewGameTime('20:00');
      setNewGameRecurring('monthly');
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Create failed', text2: e.message || '' });
    } finally {
      setCreatingGame(false);
    }
  };

  const handleDeleteGame = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'games', id));
      Toast.show({ type: 'info', text1: 'Game removed' });
      setGames((prev) => (Array.isArray(prev) ? prev.filter((g) => g.id !== id) : []));
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Delete failed', text2: e.message || '' });
    }
  };

  // ensure dynamic places component is available and capitalized for JSX
  const PlacesComp: any = (placesComponent as any) ?? null;

  // --- Jersey component (accepts optional onPress) ---
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
  // --- end Jersey ---

  // Basic runtime guards to avoid crashes when user/team data are not loaded
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={{ marginTop: 10 }}>Loading dashboard...</Text>
      </View>
    );
  }
  
  // If there's no signed-in user, send to login
  if (!user) {
    // don't render anything while router navigates
    router.replace('/(auth)/LoginScreen');
    return null;
  }

  // If user is signed-in but team data missing, show a friendly message and navigation
  if (!teamData?.id) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 18, color: '#444', textAlign: 'center', marginBottom: 12 }}>
          No team data available. Create or join a team to manage it.
        </Text>
        <Button title="Create Team" onPress={() => router.push('/(tabs)/CreateTeamScreen')} />
        <View style={{ height: 8 }} />
        <Button title="Join Team" onPress={() => router.push('/(tabs)/JoinTeamScreen')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Coordinator Dashboard</Text>

      {/* Team name: editable only when editing */}
      {editing ? (
        <TextInput
          style={styles.input}
          value={teamData.teamName}
          onChangeText={(text) => setTeamData({ ...teamData, teamName: text })}
          editable
          placeholder="Team Name"
        />
      ) : (
        <Text style={styles.readOnlyText}>{teamData.teamName}</Text>
      )}

      {/* Location: editable only when editing */}
      {editing ? (
        PlacesComp ? (
          <PlacesComp
            ref={autocompleteRef}
            placeholder="Search ice rink..."
            fetchDetails
            onPress={(data: any, details: any = null) => {
              const lat = details?.geometry?.location?.lat ?? 0;
              const lng = details?.geometry?.location?.lng ?? 0;
              setTeamData({ ...teamData, location: data.description, latitude: lat, longitude: lng });
            }}
            query={{ key: GOOGLE_MAPS_API_KEY, language: 'en', types: 'establishment' }}
            styles={{ textInput: styles.input, container: { marginBottom: 10 } }}
          />
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

      {editing ? (
        <Button title="Save Changes" onPress={handleSaveTeam} />
      ) : (
        <Button title="Edit Team" onPress={() => setEditing(true)} />
      )}

      <Text style={styles.subtitle}>Pending Coordinator Requests</Text>
      {requests.length === 0 ? (
        <Text style={styles.noRequests}>No pending requests</Text>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
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

      <Text style={styles.subtitle}>Games / Availability</Text>

      {/* Create game form */}
      <View style={{ borderWidth: 1, borderColor: '#eee', padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <TextInput
          style={styles.input}
          placeholder="Title"
          value={newGameTitle}
          onChangeText={setNewGameTitle}
        />
        <TextInput
          style={styles.input}
          placeholder="Date (YYYY-MM-DD)"
          value={newGameDate}
          onChangeText={setNewGameDate}
        />
        <TextInput
          style={styles.input}
          placeholder="Time (HH:MM)"
          value={newGameTime}
          onChangeText={setNewGameTime}
        />

        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
          <Button
            title={newGameType === 'home' ? 'Home' : 'Away'}
            onPress={() => setNewGameType((t) => (t === 'home' ? 'away' : 'home'))}
            color={newGameType === 'home' ? '#0a7ea4' : '#999'}
          />
          <Button
            title={newGameRecurring === 'monthly' ? 'Monthly' : 'Single'}
            onPress={() => setNewGameRecurring((r) => (r === 'monthly' ? 'none' : 'monthly'))}
            color={newGameRecurring === 'monthly' ? '#0a7ea4' : '#999'}
          />
        </View>

        <View style={{ marginTop: 6 }}>
          <Button title={creatingGame ? 'Creating...' : 'Create Game'} onPress={handleCreateGame} disabled={creatingGame} />
        </View>
      </View>

      {/* Upcoming games list */}
      {games.length === 0 ? (
        <Text style={styles.noRequests}>No scheduled games</Text>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const dt = new Date(item.startISO);
            return (
              <View style={styles.requestCard}>
                <Text style={{ fontWeight: '600' }}>{item.title} — {item.type?.toUpperCase()}</Text>
                <Text>{dt.toLocaleString()}</Text>
                {item.recurring && <Text style={{ color: '#666' }}>Recurring: {item.recurring.freq}</Text>}
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#FF3B30' }]} onPress={() => handleDeleteGame(item.id)}>
                    <Text style={styles.buttonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
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
});
