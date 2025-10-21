// app/(tabs)/CreateTeamScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
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
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

export default function CreateTeamScreen() {
  const router = useRouter();

  // ✅ Stable initial states (avoid undefined issues)
  const [teamName, setTeamName] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [loading, setLoading] = useState(false);
  const autocompleteRef = useRef<any>(null);
  const user = auth.currentUser;

  const handleCreateTeam = async () => {
    if (!user) {
      Toast.show({ type: 'error', text1: 'You must be logged in.' });
      return;
    }

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

      // ✅ Check if team name already exists
      const teamQuery = query(
        collection(db, 'teams'),
        where('teamName', '==', teamName.trim())
      );
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

      // ✅ Create team document
      const teamRef = await addDoc(collection(db, 'teams'), {
        teamName: teamName.trim(),
        location,
        latitude: coords?.latitude || null,
        longitude: coords?.longitude || null,
        homeColor,
        awayColor,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      });

      // ✅ Create or update user profile in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          teamId: teamRef.id,
          isCoordinator: true,
          createdAt: new Date().toISOString(),
        });
      } else {
        await updateDoc(userRef, { teamId: teamRef.id, isCoordinator: true });
      }

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
        text2: e?.message || 'Something went wrong.',
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

      {/* ✅ Location Autocomplete */}
      {/* <GooglePlacesAutocomplete
        ref={autocompleteRef}
        placeholder="Search rink or arena..."
        fetchDetails
        onPress={(data, details = null) => {
          const lat = details?.geometry?.location?.lat ?? 0;
          const lng = details?.geometry?.location?.lng ?? 0;
          setLocation(data.description);
          setCoords({ latitude: lat, longitude: lng });
        }}
        query={{
          key: GOOGLE_MAPS_API_KEY,
          language: 'en',
          types: 'establishment',
        }}
        styles={{
          textInput: styles.input,
          container: { marginBottom: 10 },
        }}
      /> */}

      <TextInput
        style={styles.input}
        placeholder="Location (rink or arena)"
        value={location}
        onChangeText={(text) => setLocation(text)}
      />

      <View style={styles.kitRow}>
        <Jersey color={homeColor} label="Home" />
        <Jersey color={awayColor} label="Away" />
      </View>

      {/* ✅ Color Picker Modal */}
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
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0a7ea4',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, marginBottom: 10, borderRadius: 6 },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
});
