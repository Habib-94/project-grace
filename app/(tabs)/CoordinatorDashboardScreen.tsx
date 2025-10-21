// app/(tabs)/CoordinatorDashboardScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { MapView, Marker } from 'expo-maps';
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
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

export default function CoordinatorDashboardScreen() {
  const [teamData, setTeamData] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const autocompleteRef = useRef<any>(null);
  const router = useRouter();
  const user = auth.currentUser;

  useEffect(() => {
    const loadData = async () => {
      if (!user) return router.replace('/(auth)/LoginScreen');

      try {
        await ensureFirestoreOnline();

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          Toast.show({ type: 'error', text1: 'No user record found' });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        const userData = userSnap.data();
        if (!userData.isCoordinator) {
          Toast.show({
            type: 'error',
            text1: 'Access Denied',
            text2: 'You must be a coordinator to access this page.',
          });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        const teamRef = doc(db, 'teams', userData.teamId);
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists()) {
          Toast.show({ type: 'error', text1: 'Team not found' });
          return router.replace('/(tabs)/ManageTeamScreen');
        }

        const team = { ...(teamSnap.data() as any), id: teamRef.id };
        setTeamData(team);

        if (team.latitude && team.longitude) {
          setLocationCoords({ latitude: team.latitude, longitude: team.longitude });
        }

        const q = query(
          collection(db, 'requests'),
          where('teamId', '==', teamRef.id),
          where('status', '==', 'pending')
        );
        const reqSnap = await getDocs(q);
        const fetchedRequests: any[] = [];
        reqSnap.forEach((r) => fetchedRequests.push({ id: r.id, ...r.data() }));
        setRequests(fetchedRequests);
      } catch (e) {
        console.error('❌ Error loading data:', e);
        Toast.show({ type: 'error', text1: 'Error loading team data' });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  const handleSave = async () => {
    if (!teamData) return;
    try {
      const teamRef = doc(db, 'teams', teamData.id);
      await updateDoc(teamRef, {
        teamName: teamData.teamName,
        location: teamData.location,
        latitude: locationCoords?.latitude || null,
        longitude: locationCoords?.longitude || null,
        homeColor: teamData.homeColor,
        awayColor: teamData.awayColor,
      });
      setEditing(false);
      Toast.show({ type: 'success', text1: 'Team updated successfully!' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Update failed', text2: e.message });
    }
  };

  const handleApprove = async (request: any) => {
    try {
      const userRef = doc(db, 'users', request.userId);
      await updateDoc(userRef, { isCoordinator: true, teamId: request.teamId });

      const requestRef = doc(db, 'requests', request.id);
      await updateDoc(requestRef, { status: 'approved' });

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
      setRequests(requests.filter((r) => r.id !== request.id));
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error approving request', text2: e.message });
    }
  };

  const handleReject = async (id: string) => {
    try {
      const requestRef = doc(db, 'requests', id);
      await updateDoc(requestRef, { status: 'rejected' });
      setRequests(requests.filter((r) => r.id !== id));
      Toast.show({ type: 'info', text1: 'Request Rejected' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'Error rejecting request', text2: e.message });
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text>Loading coordinator dashboard...</Text>
      </View>
    );
  }

  if (!teamData) {
    return (
      <View style={styles.center}>
        <Text>No team data found.</Text>
      </View>
    );
  }

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
            const lat = details?.geometry?.location?.lat ?? 0;
            const lng = details?.geometry?.location?.lng ?? 0;
            setTeamData({ ...teamData, location: data.description });
            setLocationCoords({ latitude: lat, longitude: lng });
          }}
          query={{ key: GOOGLE_MAPS_API_KEY, language: 'en', types: 'establishment' }}
          styles={{ textInput: styles.input, container: { marginBottom: 10 } }}
        />
      )}

      {/* 🔹 Map Preview */}
      {locationCoords && (
        <MapView
          style={styles.map}
          initialCameraPosition={{
            center: {
              latitude: locationCoords.latitude,
              longitude: locationCoords.longitude,
            },
            zoom: 15,
          }}
        >
          <Marker coordinate={locationCoords} title={teamData.location} />
        </MapView>
      )}

      <View style={styles.kitRow}>
        <Jersey color={teamData.homeColor} label="Home" />
        <Jersey color={teamData.awayColor} label="Away" />
      </View>

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

      {editing ? (
        <Button title="Save Changes" onPress={handleSave} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: '#0a7ea4' },
  subtitle: { fontSize: 20, fontWeight: '600', marginVertical: 15, color: '#0a7ea4' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 10, borderRadius: 6 },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  map: { width: '100%', height: 200, borderRadius: 10, marginBottom: 20 },
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
  buttonText: { color: 'white', fontWeight: '600' },
  noRequests: { textAlign: 'center', color: '#999', fontSize: 16 },
});
