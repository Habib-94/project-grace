import { auth, db } from '@/firebaseConfig';
import { Image as ExpoImage } from 'expo-image';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const user = auth.currentUser;

  useEffect(() => {
    let isMounted = true;

    const fetchTeamData = async () => {
      if (!user) return;
      try {
        await new Promise((res) => setTimeout(res, 500)); // allow Firestore to connect

        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && isMounted) {
          setTeamData(docSnap.data());
        } else if (isMounted) {
          console.warn('No such document!');
        }
      } catch (error: any) {
        console.error('Failed to fetch team data:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTeamData();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('User signed out');
    } catch (error: any) {
      console.error('Logout failed:', error.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Loading team data...</Text>
      </View>
    );
  }

  const homeColor = teamData?.homeColor || '#0a7ea4';
  const awayColor = teamData?.awayColor || '#ffffff';

  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <View style={styles.jerseyContainer}>
      {/* Color fill */}
      <ExpoImage
        source={require('@/assets/images/jersey_fill.png')}
        style={[styles.jerseyFill, { tintColor: color }]}
        contentFit="contain"
      />
      {/* Outline overlay */}
      <ExpoImage
        source={require('@/assets/images/jersey_outline.png')}
        style={styles.jerseyOutline}
        contentFit="contain"
      />
      <Text style={styles.jerseyLabel}>{label}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {teamData ? (
        <>
          <Text style={styles.teamName}>{teamData.teamName}</Text>

          <View style={styles.kitRow}>
            <Jersey color={homeColor} label="Home" />
            <Jersey color={awayColor} label="Away" />
          </View>
        </>
      ) : (
        <Text>No team data found.</Text>
      )}

      <Button title="Logout" onPress={handleLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  teamName: { fontSize: 28, fontWeight: 'bold', color: '#0a7ea4', marginBottom: 30 },
  kitRow: { flexDirection: 'row', gap: 30, marginBottom: 30 },
  jerseyContainer: { alignItems: 'center' },
  jerseyFill: {
    width: 120,
    height: 120,
    position: 'absolute',
  },
  jerseyOutline: {
    width: 120,
    height: 120,
  },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#0a7ea4' },
});
