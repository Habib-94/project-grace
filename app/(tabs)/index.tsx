import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { debugAuthState, getDocument, runCollectionQuery } from '@/firestoreRest';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(null);
  const [gameRequests, setGameRequests] = useState<any[]>([]);
  const [loadingGameRequests, setLoadingGameRequests] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const user = auth?.currentUser ?? null;

  // small helper: wait for auth.currentUser to appear (poll), returns currentUser or null
  async function waitForAuthUser(timeout = 5000) {
    const start = Date.now();
    while (!auth?.currentUser && Date.now() - start < timeout) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
    }
    return auth?.currentUser ?? null;
  }

  // Fetch pending game requests for the current team (REST)
  async function fetchGameRequests(teamId?: string) {
    if (!teamId) {
      setGameRequests([]);
      return;
    }
    setLoadingGameRequests(true);

    // Ensure auth is ready (ID token needed by rules in many setups)
    await waitForAuthUser(5000);

    // Log token/payload to help debug permission issues (check console)
    try {
      debugAuthState?.('Home.fetchGameRequests'); // prints token presence / payload if available
    } catch (e) {
      // ignore debug helper errors
    }

    try {
      await ensureFirestoreOnline();
      const docs = await runCollectionQuery({
        collectionId: 'gameRequests',
        where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamId }],
        limit: 50,
      });
      const items = (docs as any[]).map((d) => ({ id: d.id, ...(d as any) }));
      setGameRequests(items);
      setLoadingGameRequests(false);
    } catch (e: any) {
      // If permission denied, try one short retry (auth race)
      const isPermDenied =
        (e && typeof e.message === 'string' && e.message.includes('403')) ||
        (e && e?.toString?.().includes('PERMISSION_DENIED'));

      if (isPermDenied) {
        console.warn('Home: gameRequests PERMISSION_DENIED. Will retry once after short delay. Error:', e);
        // short retry after waiting for auth once more
        await new Promise((r) => setTimeout(r, 1200));
        try {
          await ensureFirestoreOnline();
          const docs = await runCollectionQuery({
            collectionId: 'gameRequests',
            where: [{ fieldPath: 'teamId', op: 'EQUAL', value: teamId }],
            limit: 50,
          });
          const items = (docs as any[]).map((d) => ({ id: d.id, ...(d as any) }));
          setGameRequests(items);
        } catch (e2: any) {
          console.warn('Home: retry also failed for gameRequests', e2);
          setGameRequests([]);
        } finally {
          setLoadingGameRequests(false);
        }
      } else {
        console.warn('Home: failed to load game requests', e);
        setGameRequests([]);
        setLoadingGameRequests(false);
      }
    }
  }

  useEffect(() => {
    if (teamData?.id) fetchGameRequests(teamData.id);
    else setGameRequests([]);
  }, [teamData?.id]);

  useEffect(() => {
    let mounted = true;

    if (!user) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Two runtime paths:
        // - native @react-native-firebase: db.collection('users').doc(uid).get()
        // - web SDK: use REST helper getDocument(...) to avoid streaming issues
        if (db && typeof (db as any).collection === 'function') {
          // Native firestore usage
          const uSnap = await (db as any).collection('users').doc(user.uid).get();
          if (!mounted) return;
          if (!uSnap?.exists) {
            setUserData(null);
            setTeamData(null);
            setLoading(false);
            return;
          }
          const u = uSnap.data();
          setUserData(u);

          if (u?.teamId) {
            const tSnap = await (db as any).collection('teams').doc(u.teamId).get();
            if (!mounted) return;
            if (tSnap?.exists) {
              setTeamData({ id: tSnap.id, ...(tSnap.data() ?? {}) });
            } else {
              setTeamData(null);
            }
          } else {
            setTeamData(null);
          }
        } else {
          // Web SDK / Expo Go: use REST helper to fetch documents (avoids Firestore web streaming)
          const u = await getDocument(`users/${user.uid}`);
          if (!mounted) return;
          if (!u) {
            setUserData(null);
            setTeamData(null);
            setLoading(false);
            return;
          }
          setUserData(u);

          if (u?.teamId) {
            const t = await getDocument(`teams/${u.teamId}`);
            if (!mounted) return;
            if (t) {
              setTeamData(t);
            } else {
              setTeamData(null);
            }
          } else {
            setTeamData(null);
          }
        }
      } catch (err) {
        console.warn('one-time getDoc error', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  const handleLogout = async () => {
    try {
      // Native auth has signOut method, web auth as well. Our auth is `any`.
      await (auth as any).signOut();
      console.log('👋 User signed out');
    } catch (error: any) {
      console.error('Logout failed:', error?.message ?? error);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
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

          {/* Pending game requests (preview) */}
          <View style={[styles.summaryBox, { marginTop: 12 }]}>
            <Text style={styles.summaryTitle}>Pending game requests</Text>
            {loadingGameRequests ? (
              <ActivityIndicator size="small" color="#0a7ea4" />
            ) : gameRequests.length === 0 ? (
              <Text style={{ color: '#666', textAlign: 'center' }}>No pending game requests</Text>
            ) : (
              <>
                {gameRequests.slice(0, 4).map((r) => (
                  <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                    <Text style={{ fontWeight: '600' }}>{r.requestingTeamName ?? r.requestingTeamId ?? 'Team'}</Text>
                    <Text style={{ color: '#666' }}>{r.title ?? 'Game request'}</Text>
                    {r.startISO ? <Text style={{ color: '#666', fontSize: 12 }}>{new Date(r.startISO).toLocaleString()}</Text> : null}
                  </View>
                ))}
                {gameRequests.length > 4 ? <Text style={{ color: '#666', marginTop: 8 }}>{gameRequests.length} total</Text> : null}
                <View style={{ marginTop: 8, alignItems: 'center' }}>
                  <Pressable onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')} style={[styles.smallBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0a7ea4' }]}>
                    <Text style={[styles.smallBtnText, { color: '#0a7ea4' }]}>Manage requests</Text>
                  </Pressable>
                </View>
              </>
            )}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#fff' },
  containerContent: { padding: 20, alignItems: 'center' },
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

  smallBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 4,
    elevation: 2,
  },
  smallBtnText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
