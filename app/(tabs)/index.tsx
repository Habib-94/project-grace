import { auth, db } from '@/firebaseConfig';
import { Image as ExpoImage } from 'expo-image';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeamData = async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const docRef = doc(db, 'users', uid);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          setTeamData(snapshot.data());
        } else {
          console.warn('No user data found.');
        }
      } catch (err) {
        console.error('Failed to fetch team data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTeamData();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('User signed out');
      // Layout handles redirection
    } catch (error: any) {
      console.error('Logout failed:', error.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!teamData) {
    return (
      <View style={styles.centered}>
        <Text>No team data found</Text>
        <Button title="Logout" onPress={handleLogout} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.teamName}>{teamData.teamName}</Text>

      <View style={styles.kitRow}>
        {/* Home Kit */}
        <View style={styles.kitCard}>
          <View style={styles.jerseyWrapper}>
            <ExpoImage
              source={require('@/assets/images/jersey_fill.png')}
              style={styles.jersey}
              contentFit="contain"
              tintColor={teamData.homeColor || '#0a7ea4'}
            />
            <ExpoImage
              source={require('@/assets/images/jersey_outline.png')}
              style={styles.jersey}
              contentFit="contain"
            />
          </View>
          <Text style={styles.kitLabel}>Home</Text>
        </View>

        {/* Away Kit */}
        <View style={styles.kitCard}>
          <View style={styles.jerseyWrapper}>
            <ExpoImage
              source={require('@/assets/images/jersey_fill.png')}
              style={styles.jersey}
              contentFit="contain"
              tintColor={teamData.awayColor || '#ffffff'}
            />
            <ExpoImage
              source={require('@/assets/images/jersey_outline.png')}
              style={styles.jersey}
              contentFit="contain"
            />
          </View>
          <Text style={styles.kitLabel}>Away</Text>
        </View>
      </View>

      <View style={styles.logoutContainer}>
        <Button title="Logout" onPress={handleLogout} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 50,
    backgroundColor: '#fff',
  },
  teamName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0a7ea4',
    textAlign: 'center',
  },
  kitRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginVertical: 30,
  },
  kitCard: {
    alignItems: 'center',
  },
  jerseyWrapper: {
    width: 120,
    height: 120,
    position: 'relative',
  },
  jersey: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  kitLabel: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  logoutContainer: {
    marginBottom: 20,
  },
});
