// app/(tabs)/TeamDetailScreen.tsx
import { auth, ensureFirestoreOnline } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';
import { getDocument } from '../../src/firestoreRest';

export default function TeamDetailScreen() {
  const router = useRouter();
  const user = auth.currentUser;
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!user) return router.replace('/(auth)/LoginScreen');

      try {
        await ensureFirestoreOnline();
        const userDoc = await getDocument(`users/${user.uid}`);

        if (!userDoc) {
          Toast.show({ type: 'error', text1: 'No user record found' });
          router.replace('/(tabs)/HomeScreen');
          return;
        }

        const userData = userDoc as any;
        if (!userData.isCoordinator) {
          Toast.show({
            type: 'error',
            text1: 'Access Denied',
            text2: 'You must be a coordinator to access this page.',
          });
          router.replace('/(tabs)/HomeScreen');
        } else {
          setAllowed(true);
        }
      } catch (err) {
        console.error('Permission check failed:', err);
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: 'Failed to verify permissions.',
        });
        router.replace('/(tabs)/HomeScreen');
      }
    };

    checkPermissions();
  }, [router, user]);

  if (allowed === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text>Checking access...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Team Management Tools</Text>
      {/* Coordinator tools go here */}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0a7ea4' },
});
