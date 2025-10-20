// app/_layout.tsx
import { AuthProvider } from '@/context/AuthContext';
import { ensureFirestoreOnline } from '@/firebaseConfig';
import { Slot } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/**
 * Root layout wraps everything with AuthProvider and ensures Firestore is online.
 */
export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        console.log('🔌 Connecting Firestore…');
        await ensureFirestoreOnline();
        console.log('✅ Firestore connection established');
      } catch (err) {
        console.warn('⚠️ Failed to ensure Firestore online:', err);
      } finally {
        setReady(true);
      }
    };

    init();
  }, []);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={styles.text}>Initializing App…</Text>
      </View>
    );
  }

  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    marginTop: 10,
    color: '#333',
  },
});
