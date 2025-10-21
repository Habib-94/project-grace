import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const user = auth.currentUser;

  useEffect(() => {
    let userUnsub: (() => void) | null = null;
    let teamUnsub: (() => void) | null = null;

    if (!user) {
      setLoading(false);
      return;
    }

    (async () => {
      await ensureFirestoreOnline();

      // subscribe to user doc so we react to teamId/isCoordinator changes
      const uRef = doc(db, 'users', user.uid);
      userUnsub = onSnapshot(
        uRef,
        (uSnap) => {
          if (!uSnap.exists()) {
            setUserData(null);
            setTeamData(null);
            setLoading(false);
            return;
          }
          const u = uSnap.data() as any;
          setUserData(u);

          // subscribe to team doc when teamId present
          if (teamUnsub) {
            teamUnsub();
            teamUnsub = null;
          }
          if (u?.teamId) {
            const tRef = doc(db, 'teams', u.teamId);
            teamUnsub = onSnapshot(
              tRef,
              (tSnap) => {
                if (tSnap.exists()) {
                  setTeamData({ id: tSnap.id, ...(tSnap.data() as any) });
                } else {
                  setTeamData(null);
                }
                setLoading(false);
              },
              (err) => {
                console.warn('Team onSnapshot error', err);
                setLoading(false);
              }
            );
          } else {
            setTeamData(null);
            setLoading(false);
          }
        },
        (err) => {
          console.warn('User onSnapshot error', err);
          setLoading(false);
        }
      );
    })();

    return () => {
      if (userUnsub) userUnsub();
      if (teamUnsub) teamUnsub();
    };
  }, [user?.uid]);

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
      return <Button title="Manage Team" onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')} />;
    }
    return <Button title="Join Team" onPress={() => router.push('/(tabs)/FindATeam')} />;
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

          {/* New summary box: role and kit colours */}
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>Your Team Summary</Text>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Role:</Text>
              <Text style={styles.summaryValue}>
                {userData?.isCoordinator ? 'Coordinator' : 'Member'}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Kit Colours:</Text>
              <View style={styles.swatches}>
                <View style={styles.swatchItem}>
                  <View style={[styles.kitSwatch, { backgroundColor: homeColor }]} />
                  <Text style={styles.swatchLabel}>Home</Text>
                </View>
                <View style={styles.swatchItem}>
                  <View style={[styles.kitSwatch, { backgroundColor: awayColor }]} />
                  <Text style={styles.swatchLabel}>Away</Text>
                </View>
              </View>
            </View>
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

  /* New styles for summary */
  summaryBox: {
    width: '100%',
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f7fbfd',
    borderColor: '#e6f2f6',
    borderWidth: 1,
    marginTop: 10,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 10,
    textAlign: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: { fontSize: 14, color: '#333', fontWeight: '600' },
  summaryValue: { fontSize: 14, color: '#333' },

  swatches: { flexDirection: 'row', gap: 16 },
  swatchItem: { alignItems: 'center', marginLeft: 8 },
  kitSwatch: { width: 34, height: 34, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  swatchLabel: { marginTop: 6, fontSize: 12, color: '#333' },
});
