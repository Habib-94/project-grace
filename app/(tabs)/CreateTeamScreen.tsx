// app/(tabs)/CreateTeamScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import React, { useRef, useState } from 'react';
import {
  Button,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import MapView, { Marker } from 'react-native-maps';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

export default function CreateTeamScreen() {
  const router = useRouter();
  const [teamName, setTeamName] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [loading, setLoading] = useState(false);
  const autocompleteRef = useRef<any>(null);

  const user = auth.currentUser;

  const handleCreateTeam = async () => {
    if (!user) return;
    if (!teamName.trim() || !location.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Missing fields',
        text2: 'Please enter a team name and select a location.',
      });
      return;
    }

    setLoading(true);

    try {
      await ensureFirestoreOnline();

      // ✅ Check for existing team name
      const teamQuery = query(collection(db, 'teams'), where('teamName', '==', teamName.trim()));
      const existingTeams = await getDocs(teamQuery);

      if (!existingTeams.empty) {
        setLoading(false);
        Toast.show({
          type: 'error',
          text1: 'Team name taken',
          text2: 'Please choose a different name.',
        });
        return;
      }

      // ✅ Create team in Firestore
      const teamRef = await addDoc(collection(db, 'teams'), {
        teamName: teamName.trim(),
        location,
        latitude: coords?.lat || null,
        longitude: coords?.lng || null,
        homeColor,
        awayColor,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      });

      // ✅ Update user record
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        teamId: teamRef.id,
        isCoordinator: true,
      });

      Toast.show({
        type: 'success',
        text1: 'Team Created!',
        text2: 'You are now the coordinator.',
      });

      router.replace('/(tabs)/CoordinatorDashboardScreen');
    } catch (e: any) {
      console.error('❌ Error creating team:', e);
      Toast.show({
        type: 'error',
        text1: 'Error creating team',
        text2: e.message || 'Something went wrong.',
      });
    } finally {
      setLoading(false);
    }
  };

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create a New Team</Text>

      <TextInput
        style={styles.input}
        placeholder="Team Name"
        value={teamName}
        onChangeText={setTeamName}
      />

      <GooglePlacesAutocomplete
        ref={autocompleteRef}
        placeholder="Search rink or arena..."
        fetchDetails
        onPress={(data, details = null) => {
          const lat = details?.geometry?.location?.lat;
          const lng = details?.geometry?.location?.lng;
          setLocation(data.description);
          setCoords({ lat, lng });
        }}
        query={{ key: GOOGLE_MAPS_API_KEY, language: 'en', types: 'establishment' }}
        styles={{
          textInput: styles.input,
          container: { marginBottom: 10 },
        }}
      />

      {coords && (
        <MapView
          style={styles.map}
          region={{
            latitude: coords.lat,
            longitude: coords.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }} title={location} />
        </MapView>
      )}

      <View style={styles.kitRow}>
        <Jersey color={homeColor} label="Home" />
        <Jersey color={awayColor} label="Away" />
      </View>

      <Modal visible={!!activePicker} animationType="slide">
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>
            Pick {activePicker === 'home' ? 'Home' : 'Away'} Kit Color
          </Text>
          <ColorPicker
            color={activePicker === 'home' ? homeColor : awayColor}
            onColorChangeComplete={(color: string) => {
              if (activePicker === 'home') setHomeColor(color);
              else setAwayColor(color);
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

      <View style={{ marginTop: 20 }}>
        <Button
          title={loading ? 'Creating...' : 'Create Team'}
          onPress={handleCreateTeam}
          disabled={loading}
          color="#0a7ea4"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 10, borderRadius: 6 },
  map: { width: '100%', height: 200, borderRadius: 10, marginBottom: 20 },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
});
