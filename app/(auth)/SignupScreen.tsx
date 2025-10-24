// app/(auth)/SignupScreen.tsx
import { useRouter } from 'expo-router';
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
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';

/**
 * Runtime-safe helpers:
 * - createUserSafe: creates an auth user using the native SDK if present, otherwise web SDK.
 * - setUserDocSafe: writes users/{uid} using native firestore if present, otherwise web SDK.
 */

async function createUserSafe(email: string, password: string) {
  // Native RN Firebase auth instance typically exposes createUserWithEmailAndPassword on the instance
  try {
    const a = auth as any;
    if (a && typeof a.createUserWithEmailAndPassword === 'function') {
      // native SDK returns a user credential-like object
      return await a.createUserWithEmailAndPassword(email, password);
    }
  } catch {
    // fallthrough to web path
  }

  // Web modular fallback
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  return await createUserWithEmailAndPassword(auth as any, email, password);
}

async function updateProfileSafe(user: any, profile: { displayName?: string }) {
  try {
    // native: user.updateProfile may exist
    if (user && typeof user.updateProfile === 'function') {
      await user.updateProfile(profile);
      return;
    }
  } catch {
    // fallthrough
  }

  // web fallback
  const { updateProfile } = await import('firebase/auth');
  await updateProfile(user, profile);
}

async function setUserDocSafe(uid: string, data: any) {
  // native Firestore: db.collection(...).doc(uid).set(...)
  try {
    const f = db as any;
    if (f && typeof f.collection === 'function') {
      // native API compatibility
      return await f.collection('users').doc(uid).set(data);
    }
  } catch {
    // fallthrough to web
  }

  // web modular fallback
  const { doc, setDoc } = await import('firebase/firestore');
  return await setDoc(doc(db as any, 'users', uid), data);
}

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

      // Ensure Firestore network is enabled (works for both runtimes)
      await ensureFirestoreOnline();

      // Create auth user in a runtime-safe way
      const cred = await createUserSafe(email.trim().toLowerCase(), password);
      const user = cred?.user ?? cred; // native may return different shape
      const uid = user?.uid;
      if (!uid) {
        throw new Error('Failed to create user (no uid returned).');
      }

      // Update auth display name (runtime-safe)
      try {
        await updateProfileSafe(user, { displayName: name });
      } catch (profileErr) {
        console.warn('[Signup] updateProfile failed', profileErr);
      }

      // Create the Firestore user document in a runtime-safe manner
      try {
        await setUserDocSafe(uid, {
          uid,
          name,
          email: email.trim().toLowerCase(),
          role: 'standard',
          teamId: null,
          isCoordinator: false,
          createdAt: new Date().toISOString(),
        });
        console.log(`✅ Firestore user created: users/${uid}`);
      } catch (setErr) {
        // If writing the user doc fails, surface a warning but don't block login flow.
        // Dashboard/getDocument will otherwise 404; better to ensure we created the doc.
        console.warn('[Signup] failed to create users/{uid} doc', setErr);
        // Re-throw only if you want to block the flow:
        // throw setErr;
      }

      Alert.alert('Account Created', 'You can now create or join a team.');
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('❌ Signup failed:', e);
      Alert.alert('Signup Failed', e?.message ?? 'Unknown error occurred.');
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
