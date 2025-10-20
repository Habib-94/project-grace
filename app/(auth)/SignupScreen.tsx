// app/(auth)/SignupScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignup = async () => {
    if (!name || !email || !password) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }

    try {
      setLoading(true);

      // 🔌 Ensure Firestore is online before writing
      await ensureFirestoreOnline();

      // 🔐 Create user in Firebase Authentication
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      const user = cred.user;
      const uid = user.uid;

      // 🧾 Optionally set the display name in Firebase Auth
      await updateProfile(user, { displayName: name });

      // 🗄️ Create user doc in Firestore
      await setDoc(doc(db, 'users', uid), {
        uid,
        name,
        email: email.toLowerCase(),
        role: 'standard', // default role
        teamId: null,
        createdAt: new Date().toISOString(),
      });

      console.log(`✅ Firestore user created: users/${uid}`);

      Alert.alert('Account Created', 'You can now create or join a team.');
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('❌ Signup failed:', e);
      Alert.alert('Signup Failed', e.message || 'Unknown error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Create Account</Text>

        <TextInput
          style={styles.input}
          placeholder="Full Name"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <View style={{ width: '100%', marginTop: 10 }}>
          <Button
            title={loading ? 'Creating Account…' : 'Sign Up'}
            onPress={handleSignup}
            disabled={loading}
          />
        </View>

        <View style={{ marginTop: 15 }}>
          <Button
            title="Back to Login"
            color="#0a7ea4"
            onPress={() => router.push('/(auth)/LoginScreen')}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0a7ea4',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    width: '100%',
    padding: 12,
    marginBottom: 10,
  },
});
