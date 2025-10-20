import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import type { Team, User } from '@/types/firestore';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where,
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
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import MapView, { Marker } from 'react-native-maps';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

interface Request {
  id: string;
  userId: string;
  userEmail: string;
  teamId: string;
  status: 'pending' | 'approved' | 'rejected';
}

export default function CoordinatorDashboardScreen() {
  const [teamData, setTeamData] = useState<Team | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const autocompleteRef = useRef<any>(null);

  const router = useRouter();
  const user = auth.currentUser;

  /** 🔹 Load coordinator + team data */
  useEffect(() => {
    const loadData = async () => {
      if (!user) return router.replace('/(auth)/LoginScreen');

      try {
        await ensureFirestoreOnline();

        // Get user info
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) {
          Toast.show({ type: 'error', text1: 'User not found' });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        const userData = userSnap.data() as User;
        if (!userData.isCoordinator || !userData.teamId) {
          Toast.show({
            type: 'error',
            text1: 'Access Denied',
            text2: 'Coordinator access only.',
          });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        // Get team info
        const teamSnap = await getDoc(doc(db, 'teams', userData.teamId));
        if (!teamSnap.exists()) {
          Toast.show({ type: 'error', text1: 'Team not found' });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        const team = { id: teamSnap.id, ...(teamSnap.data() as Team) };
        setTeamData(team);

        if (team.latitude && team.longitude)
          setLocationCoords({ lat: team.latitude, lng: team.longitude });

        // Fetch pending coordinator requests
        const reqSnap = await getDocs(
          query(
            collection(db, 'requests'),
            where('teamId', '==', team.id),
            where('status', '==', 'pending')
          )
        );
        const fetched = reqSnap.docs.map(
          (r) => ({ id: r.id, ...r.data() } as Request)
        );
        setRequests(fetched);
      } catch (err: any) {
        console.error('❌ Error loading data:', err);
        Toast.show({ type: 'error', text1: 'Error loading team data', text2: err.message });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  /** 🔹 Save team changes */
  const handleSave = async () => {
    if (!teamData) return;

    try {
      const ref = doc(db, 'teams', teamData.id);
      await updateDoc(ref, {
        teamName: teamData.teamName,
        location: teamData.location,
        latitude: locationCoords?.lat || null,
        longitude: locationCoords?.lng || null,
        homeColor: teamData.homeColor,
        awayColor: teamData.awayColor,
      });
      setEditing(false);
      Toast.show({ type: 'success', text1: 'Team updated successfully!' });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Update failed', text2: err.message });
    }
  };

  /** 🔹 Approve a coordinator request */
  const handleApprove = async (request: Request) => {
    try {
      await updateDoc(doc(db, 'users', request.userId), {
        isCoordinator: true,
        teamId: request.teamId,
      });
      await updateDoc(doc(db, 'requests', request.id), { status: 'approved' });

      // Delete other pending requests for this team
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

      setRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Approval failed', text2: err.message });
    }
  };

  /** 🔹 Reject a coordinator request */
  const handleReject = async (id: string) => {
    try {
      await updateDoc(doc(db, 'requests', id), { status: 'rejected' });
      setRequests((prev) => prev.filter((r) => r.id !== id));
      Toast.show({ type: 'info', text1: 'Request rejected' });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Rejection failed', text2: err.message });
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text>Loading coordinator dashboard...</Text>
      </View>
    );

  if (!teamData)
    return (
      <View style={styles.center}>
        <Text>No team data found.</Text>
      </View>
    );

  /** 🧩 Jersey Color Component */
  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <TouchableOpacity onPress={() => setActivePicker(label.toLowerCase() as 'home' | 'away')}>
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Coordinator Dashboard</Text>

      {/* 🔹 Team Name */}
      <TextInput
        style={styles.input}
        value={teamData.teamName}
        onChangeText={(text) => setTeamData({ ...teamData, teamName: text })}
        editable={editing}
        placeholder="Team Name"
      />

      {/* 🔹 Location Autocomplete */}
      {editing && (
        <GooglePlacesAutocomplete
          ref={autocompleteRef}
          placeholder="Search ice rink..."
          fetchDetails
          onPress={(data, details = null) => {
            const lat = details?.geometry?.location?.lat;
            const lng = details?.geometry?.location?.lng;
            setTeamData({ ...teamData, location: data.description });
            setLocationCoords({ lat, lng });
          }}
          query={{ key: GOOGLE_MAPS_API_KEY, language: 'en', types: 'establishment' }}
          styles={{ textInput: styles.input, container: { marginBottom: 10 } }}
        />
      )}

      {/* 🔹 Map Preview */}
      {locationCoords && (
        <MapView
          style={styles.map}
          region={{
            latitude: locationCoords.lat,
            longitude: locationCoords.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Marker coordinate={locationCoords} title={teamData.location} />
        </MapView>
      )}

      {/* 🔹 Kit Colors */}
      <View style={styles.kitRow}>
        <Jersey color={teamData.homeColor ?? '#0a7ea4'} label="Home" />
        <Jersey color={teamData.awayColor ?? '#ffffff'} label="Away" />
      </View>

      {/* 🔹 Color Picker Modal */}
      <Modal visible={!!activePicker} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>
            Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color
          </Text>
          <ColorPicker
            color={activePicker === 'home' ? teamData.homeColor : teamData.awayColor}
            onColorChangeComplete={(color: string) => {
              if (activePicker === 'home') setTeamData({ ...teamData, homeColor: color });
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

      {/* 🔹 Edit / Save */}
      {editing ? (
        <Button title="Save Changes" onPress={handleSave} />
      ) : (
        <Button title="Edit Team" onPress={() => setEditing(true)} />
      )}

      {/* 🔹 Requests */}
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
    </View>
  );
}

/* 🔹 Styles */
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
  subtitle: { fontSize: 20, fontWeight: '600', marginVertical: 15, color: '#0a7ea4' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 10, borderRadius: 6 },
  map: { width: '100%', height: 200, borderRadius: 10, marginBottom: 20 },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  requestCard: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 10 },
  requestEmail: { fontSize: 16, fontWeight: '500', marginBottom: 10 },
  requestButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  actionButton: { flex: 1, padding: 10, borderRadius: 6, marginHorizontal: 5, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  noRequests: { textAlign: 'center', color: '#999', fontSize: 16 },
});
