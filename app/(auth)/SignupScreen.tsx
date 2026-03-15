// app/(auth)/SignupScreen.tsx
import { useAuth } from '@/context/AuthContext';
import {
  checkPasswordRequirements,
  sanitizeEmail,
  sanitizeText,
  validatePassword,
} from '@/src/utils/security';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

/** Map Firebase Auth error codes to user-friendly messages. */
function getFriendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Please choose a stronger password.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.';
    default:
      return 'Sign up failed. Please try again.';
  }
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
  const { signUp } = useAuth();

  const passwordChecks = useMemo(
    () => checkPasswordRequirements(password),
    [password]
  );

  const handleSignup = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail || !password) {
      Toast.show({
        type: 'error',
        text1: 'Missing fields',
        text2: 'Please fill in all fields.',
      });
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      Toast.show({
        type: 'error',
        text1: 'Weak password',
        text2: passwordValidation.error ?? 'Please choose a stronger password.',
      });
      return;
    }

    try {
      setLoading(true);
      const sanitizedName = sanitizeText(trimmedName, 100);
      const sanitizedEmail = sanitizeEmail(trimmedEmail);
      await signUp(sanitizedEmail, password, sanitizedName);
      // Navigation handled by auth layout reacting to user state change
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      Toast.show({
        type: 'error',
        text1: 'Sign up failed',
        text2: getFriendlyAuthError(code),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Create Account</Text>

        <TextInput
          style={styles.input}
          placeholder="Full Name"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          textContentType="name"
          returnKeyType="next"
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          returnKeyType="next"
          editable={!loading}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleSignup}
          editable={!loading}
        />

        {password.length > 0 && (
          <View style={styles.passwordRequirements}>
            <Text style={styles.requirementsTitle}>Password Requirements:</Text>
            <PasswordRequirement
              met={passwordChecks.minLength}
              text="At least 8 characters"
            />
            <PasswordRequirement
              met={passwordChecks.hasUppercase}
              text="Contains an uppercase letter"
            />
            <PasswordRequirement
              met={passwordChecks.hasSpecialChar}
              text="Contains a special character (!@#$%^&*)"
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {loading ? 'Creating Account…' : 'Sign Up'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push('/(auth)/LoginScreen')}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Back to Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
