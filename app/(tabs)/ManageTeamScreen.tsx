// app/(tabs)/ManageTeamScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, StyleSheet, Text, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function ManageTeamScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const user = auth.currentUser;

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        await ensureFirestoreOnline();

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          console.warn('⚠️ No user document found for:', user.uid);
          Toast.show({ type: 'error', text1: 'User record not found' });
          return;
        }

        const userInfo = userSnap.data();
        setUserData(userInfo);

        // Fetch team info if user belongs to one
        if (userInfo.teamId) {
          const teamRef = doc(db, 'teams', userInfo.teamId);
          const teamSnap = await getDoc(teamRef);
          if (teamSnap.exists()) setTeamData(teamSnap.data());
        }
      } catch (error) {
        console.error('❌ Error fetching team data:', error);
        Toast.show({ type: 'error', text1: 'Failed to load team info' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const handleLeaveTeam = async () => {
    if (!userData?.teamId) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { teamId: null, isCoordinator: false });
      setUserData({ ...userData, teamId: null, isCoordinator: false });
      setTeamData(null);
      Alert.alert('Team Left', 'You have successfully left your team.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to leave team.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text>Loading team data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Team Management</Text>

      {/* 🧩 No team yet */}
      {!userData?.teamId && (
        <>
          <Text style={styles.subtitle}>You’re not part of a team yet.</Text>
          <View style={styles.buttonGroup}>
            <Button
              title="Create a Team"
              onPress={() => router.push('/(tabs)/CreateTeamScreen')}
              color="#0a7ea4"
            />
          </View>
          <View style={styles.buttonGroup}>
            <Button
              title="Join a Team"
              onPress={() => router.push('/(tabs)/JoinTeamScreen')}
              color="#0a7ea4"
            />
          </View>
        </>
      )}

      {/* 🏒 Member of a team */}
      {userData?.teamId && teamData && (
        <>
          <Text style={styles.subtitle}>You’re part of:</Text>
          <Text style={styles.teamName}>{teamData.teamName}</Text>
          <Text style={styles.teamLocation}>{teamData.location}</Text>

          {/* Coordinator */}
          {userData?.isCoordinator ? (
            <>
              <View style={styles.buttonGroup}>
                <Button
                  title="Coordinator Dashboard"
                  onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')}
                  color="#0a7ea4"
                />
              </View>
            </>
          ) : (
            // Non-coordinator member
            <View style={styles.buttonGroup}>
              <Button title="Leave Team" onPress={handleLeaveTeam} color="#FF3B30" />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, padding: 20, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#0a7ea4', marginBottom: 20, textAlign: 'center' },
  subtitle: { fontSize: 18, color: '#333', textAlign: 'center', marginBottom: 10 },
  teamName: { fontSize: 22, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 4 },
  teamLocation: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 20 },
  buttonGroup: { marginVertical: 5 },
});
