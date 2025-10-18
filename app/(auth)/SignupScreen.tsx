import { useAuth } from '@/context/AuthContext';
import { auth, db } from '@/firebaseConfig';
import { Image as ExpoImage } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
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
import ColorPicker from 'react-native-wheel-color-picker';

export default function SignupScreen() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [location, setLocation] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [homeColor, setHomeColor] = useState('#0a7ea4');
  const [awayColor, setAwayColor] = useState('#ffffff');
  const [activePicker, setActivePicker] = useState<'home' | 'away' | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Redirect logged-in users directly to home
  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  const handleSignup = async () => {
    if (!name || !teamName || !location || !email || !password) {
      alert('Please fill in all required fields.');
      return;
    }

    setLoading(true);

    try {
      // Create user in Firebase Auth
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      // Save team data in Firestore under users/<uid>
      await setDoc(doc(db, 'users', uid), {
        uid,
        name,
        teamName,
        location,
        email,
        homeColor,
        awayColor,
        createdAt: new Date(),
      });

      alert('Team registered successfully!');

      // Redirect immediately to the home screen
      router.replace('/(tabs)');
    } catch (e: any) {
      alert('Signup failed: ' + e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Small jersey preview component
  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <View style={styles.jerseyCard}>
      <View style={styles.jerseyBox}>
        <ExpoImage
          source={require('@/assets/images/jersey_fill.png')}
          style={styles.jerseyImg}
          contentFit="contain"
          tintColor={color}
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
    <ScrollView contentContainerStyle={styles.container}>
      {/* RHGS logo */}
      <ExpoImage
        source={require('@/assets/images/splash.png')}
        style={styles.logo}
        contentFit="contain"
      />

      <Text style={styles.title}>Register Your Team</Text>

      {/* Input fields */}
      <TextInput
        style={styles.input}
        placeholder="Your Name"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Team Name"
        value={teamName}
        onChangeText={setTeamName}
      />
      <TextInput
        style={styles.input}
        placeholder="Location"
        value={location}
        onChangeText={setLocation}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {/* Colour selection */}
      <View style={styles.kitSection}>
        <Text style={styles.subtitle}>Team Colours</Text>
        <View style={styles.kitRow}>
          <TouchableOpacity onPress={() => setActivePicker('home')}>
            <Jersey color={homeColor} label="Home" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setActivePicker('away')}>
            <Jersey color={awayColor} label="Away" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Colour picker modal */}
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

      {/* Submit button */}
      <Button
        title={loading ? 'Creating Account...' : 'Create Account'}
        onPress={handleSignup}
        disabled={loading}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  logo: { width: 200, height: 100, alignSelf: 'center', marginBottom: 10 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#0a7ea4',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
  },
  kitSection: { marginVertical: 20 },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
    textAlign: 'center',
  },
  kitRow: { flexDirection: 'row', justifyContent: 'space-around' },
  jerseyCard: { alignItems: 'center' },
  jerseyBox: { width: 110, height: 110, position: 'relative' },
  jerseyImg: { position: 'absolute', width: '100%', height: '100%' },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#000' },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#fff' },
  modalTitle: { fontSize: 20, fontWeight: '600', marginBottom: 20, textAlign: 'center' },
  modalButtons: { marginTop: 20, alignItems: 'center' },
});
