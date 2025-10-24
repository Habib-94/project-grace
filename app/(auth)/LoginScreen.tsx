import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity
} from 'react-native';
import Toast from 'react-native-toast-message';
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';
import { getDocument } from '../../src/firestoreRest';

/**
 * Runtime-safe upsert/set with merge.
 * Uses native RN Firebase API when available, otherwise web modular setDoc with { merge: true }.
 */
async function upsertUserDoc(uid: string, data: any) {
  // Native RN Firebase style
  try {
    if (db && typeof (db as any).collection === 'function') {
      // native firestore supports .doc(uid).set(data, { merge: true })
      // Some native SDK versions accept a second "options" parameter with { merge: true }
      return await (db as any).collection('users').doc(uid).set(data, { merge: true });
    }
  } catch (e) {
    // fallthrough to web
    console.warn('[upsertUserDoc] native set failed, falling back to web SDK', e);
  }

  // Web modular SDK
  const { doc, setDoc } = await import('firebase/firestore');
  return setDoc(doc(db as any, 'users', uid), data, { merge: true });
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) {
      Toast.show({
        type: 'error',
        text1: 'Missing fields',
        text2: 'Please enter both email and password.',
      });
      return;
    }

    try {
      setLoading(true);

      // Sign in the user (web/native compatible; signInWithEmailAndPassword is used for web SDK path,
      // and auth should be the native instance if native SDK is present)
      await signInWithEmailAndPassword(auth as any, email, password);

      // Make sure Firestore network is enabled before any REST/list checks or writes
      try {
        await ensureFirestoreOnline();
      } catch (e) {
        console.warn('[Login] ensureFirestoreOnline failed', e);
      }

      // Ensure a users/{uid} document exists (some flows may have missed creating it).
      // Use REST getDocument (which attaches the ID token) to check for existence.
      try {
        const user = (auth as any)?.currentUser;
        const uid = user?.uid;
        if (uid) {
          let existing: any = null;
          try {
            existing = await getDocument(`users/${uid}`);
          } catch (e) {
            // getDocument may throw 404 or permission errors; log and continue to attempt upsert
            console.warn('[Login] getDocument(users/{uid}) check failed', e);
          }

          if (!existing) {
            try {
              await upsertUserDoc(uid, {
                uid,
                name: user?.displayName ?? '',
                email: user?.email ?? '',
                role: 'standard',
                teamId: null,
                isCoordinator: false,
                createdAt: new Date().toISOString(),
              });
              console.log('[Login] created missing users/{uid} doc');
            } catch (uErr) {
              // Non-fatal — we log and continue; rules may prevent this write.
              console.warn('[Login] upsertUserDoc failed', uErr);
            }
          }
        }
      } catch (e) {
        console.warn('[Login] ensure user doc step failed', e);
      }

      Toast.show({
        type: 'success',
        text1: 'Welcome back!',
      });
      router.replace('/(tabs)');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      Toast.show({
        type: 'error',
        text1: 'Login failed',
        text2: message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Image
          source={require('@/assets/images/splash.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Login</Text>

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
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Logging in…' : 'Login'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push('/(auth)/SignupScreen')}
        >
          <Text style={styles.buttonText}>Sign Up</Text>
        </TouchableOpacity>
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
  logo: {
    width: 220,
    height: 220,
    marginBottom: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
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
  button: {
    width: '100%',
    backgroundColor: '#0a7ea4',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: '#444',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});
