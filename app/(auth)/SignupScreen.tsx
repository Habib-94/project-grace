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
import { setDocumentSafe } from '../../src/utils/firebase-helpers';
import { checkPasswordRequirements, redactSensitiveData, sanitizeEmail, sanitizeText, validatePassword } from '../../src/utils/security';

/**
 * Runtime-safe helpers:
 * - createUserSafe: creates an auth user using the native SDK if present, otherwise web SDK.
 * - setUserDocSafe: writes users/{uid} using native firestore if present, otherwise web SDK.
 */

async function createUserSafe(email: string, password: string) {  
  if (!auth) throw new Error('Auth not initialized');
  
  // Try native SDK first
  const authInstance = auth as any;
  if (authInstance && typeof authInstance.createUserWithEmailAndPassword === 'function') {
    return await authInstance.createUserWithEmailAndPassword(email, password);
  }

  // Web modular fallback
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  return await createUserWithEmailAndPassword(auth, email, password);
}

async function updateProfileSafe(user: any, profile: { displayName?: string }) {
  if (user && typeof user.updateProfile === 'function') {
    await user.updateProfile(profile);
    return;
  }

  // web fallback
  const { updateProfile } = await import('firebase/auth');
  await updateProfile(user, profile);
}

function PasswordRequirement({ met, text }: { met: boolean; text: string }) {
  return (
    <View style={styles.requirementRow}>
      <Text style={met ? styles.checkmark : styles.cross}>
        {met ? '✓' : '✗'}
      </Text>
      <Text style={[styles.requirementText, met && styles.requirementMet]}>
        {text}
      </Text>
    </View>
  );
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

      // Validate and sanitize inputs
      const sanitizedName = sanitizeText(name, 100);
      const sanitizedEmail = sanitizeEmail(email);
      
      // Validate password strength
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        Alert.alert('Weak Password', passwordValidation.error || 'Please choose a stronger password.');
        setLoading(false);
        return;
      }

      // Ensure Firestore network is enabled (works for both runtimes)
      await ensureFirestoreOnline();

      // Create auth user in a runtime-safe way
      const cred = await createUserSafe(sanitizedEmail, password);
      const user = cred?.user ?? cred; // native may return different shape
      const uid = user?.uid;
      if (!uid) {
        throw new Error('Failed to create user (no uid returned).');
      }

      // Update auth display name (runtime-safe)
      try {
        await updateProfileSafe(user, { displayName: sanitizedName });
      } catch (profileErr) {
        console.warn('[Signup] updateProfile failed', redactSensitiveData({ error: profileErr }));
      }

      // Create the Firestore user document in a runtime-safe manner
      try {
        if (!db) throw new Error('Database not initialized');
        await setDocumentSafe(db, 'users', uid, {
          uid,
          name: sanitizedName,
          email: sanitizedEmail,
          role: 'standard',
          teamId: null,
          isCoordinator: false,
          createdAt: new Date().toISOString(),
        });
        console.log(`✅ Firestore user created: users/${uid}`);
      } catch (setErr) {
        // If writing the user doc fails, surface a warning but don't block login flow.
        // Dashboard/getDocument will otherwise 404; better to ensure we created the doc.
        console.warn('[Signup] failed to create users/{uid} doc', redactSensitiveData({ error: setErr }));
        // Re-throw only if you want to block the flow:
        // throw setErr;
      }

      Alert.alert('Account Created', 'You can now create or join a team.');
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('❌ Signup failed:', redactSensitiveData({ email, error: e }));
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

        {password.length > 0 && (
          <View style={styles.passwordRequirements}>
            <Text style={styles.requirementsTitle}>Password Requirements:</Text>
            <PasswordRequirement
              met={checkPasswordRequirements(password).minLength}
              text="At least 8 characters"
            />
            <PasswordRequirement
              met={checkPasswordRequirements(password).hasUppercase}
              text="Contains an uppercase letter"
            />
            <PasswordRequirement
              met={checkPasswordRequirements(password).hasSpecialChar}
              text="Contains a special character (!@#$%^&*)"
            />
          </View>
        )}

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
  passwordRequirements: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkmark: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 8,
  },
  cross: {
    color: '#F44336',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 8,
  },
  requirementText: {
    fontSize: 13,
    color: '#666',
  },
  requirementMet: {
    color: '#4CAF50',
  },
});
