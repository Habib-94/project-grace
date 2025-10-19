import { auth, db } from '@/firebaseConfig';
import Constants from 'expo-constants';
import { Image as ExpoImage } from 'expo-image';
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import React, { useState } from 'react';
import {
    Alert,
    Button,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import ColorPicker from 'react-native-wheel-color-picker';

const GOOGLE_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

export default function CreateTeamScreen() {
  const [teamName, setTeamName] = useState('');
  const [rink, setRink] = useState<any>(null);
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Check if team already exists
  const checkTeamExists = async (name: string) => {
    const q = query(collection(db, 'teams'), where('teamName', '==', name));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  };

  // ✅ Create team and assign to user
  const handleCreateTeam = async () => {
    if (!teamName || !rink) {
      Alert.alert('Missing Information', 'Please enter a team name and select a rink.');
      return;
    }

    setLoading(true);
    try {
      const exists = await checkTeamExists(teamName.trim());
      if (exists) {
        Alert.alert('Duplicate Team', 'A team with this name already exists.');
        setLoading(false);
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        Alert.alert('Not Logged In', 'You must be logged in to create a team.');
        setLoading(false);
        return;
      }

      const teamData = {
        teamName: teamName.trim(),
        rink,
        homeColor,
        awayColor,
        coordinatorUid: user.uid,
        coordinatorEmail: user.email,
        createdAt: new Date(),
      };

      // ✅ Create team document
      const teamRef = await addDoc(collection(db, 'teams'), teamData);

      // ✅ Update user with teamId and role
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        teamId: teamRef.id,
        role: 'coordinator',
      });

      Alert.alert('Success', 'Team created successfully and assigned to your account.');
      setTeamName('');
      setRink(null);
      setHomeColor('#0a7ea4');
      setAwayColor('#ffffff');
    } catch (error: any) {
      console.error('Error creating team:', error);
      Alert.alert('Error', 'Failed to create team: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const Jersey = ({ color, label }: { color: string; label: string }) => (
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
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Create a New Team</Text>

        <TextInput
          style={styles.input}
          placeholder="Team Name"
          value={teamName}
          onChangeText={setTeamName}
        />

        <Text style={styles.subtitle}>Select Home Ice Rink</Text>
        <GooglePlacesAutocomplete
          placeholder="Search Ice Rink"
          fetchDetails={true}
          onPress={(data, details = null) => {
            setRink({
              name: data.structured_formatting.main_text,
              address: details?.formatted_address,
              lat: details?.geometry.location.lat,
              lng: details?.geometry.location.lng,
              placeId: data.place_id,
            });
          }}
          query={{
            key: GOOGLE_API_KEY,
            language: 'en',
            types: 'establishment',
          }}
          styles={{
            textInput: styles.input,
            listView: { backgroundColor: 'white' },
          }}
        />

        {rink && (
          <View style={styles.rinkPreview}>
            <Text style={styles.rinkText}>🏒 {rink.name}</Text>
            <Text style={styles.rinkAddress}>{rink.address}</Text>
          </View>
        )}

        <Text style={styles.subtitle}>Team Colours</Text>
        <View style={styles.kitRow}>
          <TouchableOpacity onPress={() => setActivePicker('home')}>
            <Jersey color={homeColor} label="Home" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActivePicker('away')}>
            <Jersey color={awayColor} label="Away" />
          </TouchableOpacity>
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
                else if (activePicker === 'away') setAwayColor(color);
              }}
              thumbSize={30}
              sliderSize={30}
              noSnap
              row={false}
              swatches
            />

            <View style={styles.modalButtons}>
              <Button title="Done" onPress={() => setActivePicker(null)} />
            </View>
          </View>
        </Modal>

        <Button
          title={loading ? 'Creating...' : 'Create Team'}
          onPress={handleCreateTeam}
          disabled={loading}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
  },
  subtitle: { fontSize: 18, fontWeight: '600', marginTop: 20, marginBottom: 10, textAlign: 'center' },
  rinkPreview: { marginVertical: 10, alignItems: 'center' },
  rinkText: { fontSize: 16, fontWeight: '600', color: '#0a7ea4' },
  rinkAddress: { fontSize: 14, color: '#666', textAlign: 'center' },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  modalButtons: { marginTop: 20, alignItems: 'center' },
});
