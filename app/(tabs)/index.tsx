import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const user = auth.currentUser;

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      if (!user) return;
      await ensureFirestoreOnline(); // 👈 Fix: make sure Firestore is online

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          console.warn('⚠️ No user document found for:', user.uid);
          return;
        }

        const userInfo = userSnap.data();
        if (isMounted) setUserData(userInfo);

        if (userInfo.teamId) {
          const teamRef = doc(db, 'teams', userInfo.teamId);
          const teamSnap = await getDoc(teamRef);
          if (teamSnap.exists() && isMounted) {
            setTeamData(teamSnap.data());
          }
        }
      } catch (error: any) {
        console.error('❌ Failed to fetch team data:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('👋 User signed out');
    } catch (error: any) {
      console.error('Logout failed:', error.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={{ marginTop: 10 }}>Loading your team...</Text>
      </View>
    );
  }

  const homeColor = teamData?.homeColor || '#0a7ea4';
  const awayColor = teamData?.awayColor || '#ffffff';

  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <View style={styles.jerseyContainer}>
      <ExpoImage
        source={require('@/assets/images/jersey_fill.png')}
        style={[styles.jerseyFill, { tintColor: color }]}
        contentFit="contain"
      />
      <ExpoImage
        source={require('@/assets/images/jersey_outline.png')}
        style={styles.jerseyOutline}
        contentFit="contain"
      />
      <Text style={styles.jerseyLabel}>{label}</Text>
    </View>
  );

  const renderRoleButton = () => {
    if (!userData?.teamId) {
      return <Button title="Create Team" onPress={() => router.push('/(tabs)/CreateTeamScreen')} />;
    }
    if (userData?.isCoordinator) {
      return <Button title="Manage Team" onPress={() => router.push('/(tabs)/ManageTeamScreen')} />;
    }
    return <Button title="Join Team" onPress={() => router.push('/(tabs)/JoinTeamScreen')} />;
  };

  return (
    <View style={styles.container}>
      {teamData ? (
        <>
          <Text style={styles.teamName}>{teamData.teamName}</Text>
          <Text style={styles.location}>{teamData.location}</Text>

          <View style={styles.kitRow}>
            <Jersey color={homeColor} label="Home" />
            <Jersey color={awayColor} label="Away" />
          </View>
        </>
      ) : (
        <Text style={styles.noTeamText}>
          You haven’t created or joined a team yet.
        </Text>
      )}

      <View style={{ marginTop: 20, width: '60%' }}>{renderRoleButton()}</View>
      <View style={{ marginTop: 10, width: '60%' }}>
        <Button title="Logout" onPress={handleLogout} color="red" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#fff' },
  teamName: { fontSize: 28, fontWeight: 'bold', color: '#0a7ea4', marginBottom: 10, textAlign: 'center' },
  location: { fontSize: 18, color: '#555', marginBottom: 30 },
  kitRow: { flexDirection: 'row', gap: 30, marginBottom: 30 },
  jerseyContainer: { alignItems: 'center' },
  jerseyFill: { width: 120, height: 120, position: 'absolute' },
  jerseyOutline: { width: 120, height: 120 },
  jerseyLabel: { marginTop: 8, fontSize: 16, fontWeight: '600', color: '#0a7ea4' },
  noTeamText: { fontSize: 16, color: '#888', textAlign: 'center', marginBottom: 30 },
});
