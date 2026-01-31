import TutorialModal from '@/components/TutorialModal';
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { debugAuthState, getDocument, listTopLevelCollection } from '@/firestoreRest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { onAppEvent } from '../../src/appEvents';

export default function HomeScreen() {
  const [userData, setUserData] = useState<any>(null);
  const [teamData, setTeamData] = useState<any>(null);
  const [gameRequests, setGameRequests] = useState<any[]>([]);
  const [loadingGameRequests, setLoadingGameRequests] = useState(false);
  const [loading, setLoading] = useState(true);
  const [homeTutorialVisible, setHomeTutorialVisible] = useState(false);
  const [homeTutorialStep, setHomeTutorialStep] = useState(0);
  const [newAccountTutorialVisible, setNewAccountTutorialVisible] = useState(false);
  // track team-specific tutorial visibility / which team we're showing for
  const [homeTutorialTeamId, setHomeTutorialTeamId] = useState<string | null>(null);

  const router = useRouter();
  const user = auth?.currentUser ?? null;
  const isFocused = useIsFocused();

  const homeTutorialKey = (uid?: string) => `tutorial_seen:${uid ?? 'anon'}:home`;
  const teamHomeTutorialKey = (teamId?: string, uid?: string) =>
    `tutorial_seen:${uid ?? 'anon'}:home:team:${teamId ?? 'none'}`;

  // new helper: key for the one-shot "new account" tutorial shown right after signup
  const newAccountTutorialKey = (uid?: string) => `tutorial_seen:${uid ?? 'anon'}:home:new_account`;

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

    // diagnostic: print auth token/payload and caller user doc to debug 403
    try {
      const dbg = await debugAuthState?.('Home.fetchGameRequests-before-runQuery');
      console.log('[Home] debugAuthState:', dbg);
    } catch (dbgErr) {
      console.warn('[Home] debugAuthState failed', dbgErr);
    }

    try {
      const callerUid = (auth as any)?.currentUser?.uid ?? null;
      console.log('[Home] callerUid:', callerUid, 'teamId being queried:', teamId);
      if (callerUid) {
        try {
          const myUser = await getDocument(`users/${callerUid}`);
          console.log('[Home] users doc for caller:', myUser);
        } catch (udErr) {
          console.warn('[Home] getDocument users/<uid> failed', udErr);
        }
      } else {
        console.warn('[Home] no auth.currentUser.uid available before runCollectionQuery');
      }
    } catch (err) {
      console.warn('[Home] diagnostics failed', err);
    }

    try {
      await ensureFirestoreOnline();

      // List the top-level 'gameRequests' collection and filter client-side for this teamId.
      // We use listTopLevelCollection to avoid runQuery -> rules mismatch issues.
      const all = await listTopLevelCollection('gameRequests', 500);
      const teamOnly = (all as any[]).filter((d) => d.teamId === teamId);
      const items = teamOnly.map((d) => ({ id: d.id, ...(d as any) }));
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
          const all = await listTopLevelCollection('gameRequests', 500);
          const teamOnly = (all as any[]).filter((d) => d.teamId === teamId);
          const items = teamOnly.map((d) => ({ id: d.id, ...(d as any) }));
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

  // Extracted refresh function: re-fetch current user's profile and team document.
  // Call this on mount and when app events arrive.
  async function refreshUserAndTeam() {
    let mounted = true;
    if (!auth || !auth.currentUser) {
      setUserData(null);
      setTeamData(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Same logic as the original one-time fetch: prefer native SDK if available, otherwise REST helper
      if (db && typeof (db as any).collection === 'function') {
        const uSnap = await (db as any).collection('users').doc(auth.currentUser.uid).get();
        if (!mounted) return;
        if (!uSnap?.exists) {
          setUserData(null);
          setTeamData(null);
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
        const u = await getDocument(`users/${auth.currentUser.uid}`);
        if (!mounted) return;
        if (!u) {
          setUserData(null);
          setTeamData(null);
          return;
        }
        setUserData(u);
        if (u?.teamId) {
          const t = await getDocument(`teams/${u.teamId}`);
          if (!mounted) return;
          if (t) setTeamData(t);
          else setTeamData(null);
        } else {
          setTeamData(null);
        }
      }
    } catch (err) {
      console.warn('refreshUserAndTeam error', err);
    } finally {
      setLoading(false);
    }
  }

  // Wire refreshUserAndTeam to initial mount (replace the previous one-time useEffect body with this call)
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    // initial load
    refreshUserAndTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Subscribe to app-level events so HomeScreen updates immediately when teams change
  useEffect(() => {
    const unsubUpdated = onAppEvent('team:updated', async (payload?: any) => {
      await refreshUserAndTeam();
      // If we are a coordinator for this team, refresh requests too
      if (teamData?.id && userData?.isCoordinator) fetchGameRequests(teamData.id);
    });

    const unsubLeft = onAppEvent('team:left', async (payload?: any) => {
      await refreshUserAndTeam();
      setGameRequests([]); // user left team so clear pending requests
    });

    const unsubDeleted = onAppEvent('team:deleted', async (payload?: any) => {
      await refreshUserAndTeam();
      setGameRequests([]);
    });

    return () => {
      try { unsubUpdated?.(); } catch {}
      try { unsubLeft?.(); } catch {}
      try { unsubDeleted?.(); } catch {}
    };
    // include teamData/userData so refresh logic sees latest context if events fire rapidly
  }, [teamData?.id, userData?.isCoordinator, user?.uid]);

  // Refresh when screen becomes focused (covers navigating back)
  useEffect(() => {
    if (isFocused) {
      refreshUserAndTeam();
      if (teamData?.id && userData?.isCoordinator) {
        fetchGameRequests(teamData.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // define multi-step tutorial content
  const homeTutorialSteps = [
    {
      title: 'Welcome to Home',
      body: 'This screen shows your team at a glance. Tap the buttons to manage or create a team.',
      size: 'small' as const,
      primaryLabel: 'Next',
    },
    {
      title: 'Kit & Role',
      body: 'See your team kit colours and whether you are a Coordinator or Member. Coordinators can schedule games.',
      size: 'small' as const,
      primaryLabel: 'Next',
    },
    {
      title: 'Requests & Actions',
      body: 'Preview pending requests, manage them from the Manage Team screen, or use Find Games to discover matches.',
      size: 'small' as const,
      primaryLabel: 'Got it',
    },
  ];

  async function closeHomeTutorial() {
    try {
      const uid = auth?.currentUser?.uid ?? null;
      // if showing for a specific team, persist the team-specific key; otherwise persist the generic home key
      if (homeTutorialTeamId) {
        const key = teamHomeTutorialKey(homeTutorialTeamId, uid ?? undefined);
        await AsyncStorage.setItem(key, '1');
      } else {
        const key = homeTutorialKey(uid ?? undefined);
        await AsyncStorage.setItem(key, '1');
      }
    } catch (e) {
      console.warn('failed to store home tutorial seen', e);
    } finally {
      setHomeTutorialVisible(false);
      setHomeTutorialTeamId(null);
    }
  }

  // primary handler: advance steps, persist only after final step
  async function handleTutorialPrimary() {
    if (homeTutorialStep < homeTutorialSteps.length - 1) {
      setHomeTutorialStep((s) => s + 1);
      return;
    }
    try {
      const uid = auth?.currentUser?.uid ?? null;
      if (homeTutorialTeamId) {
        const key = teamHomeTutorialKey(homeTutorialTeamId, uid ?? undefined);
        await AsyncStorage.setItem(key, '1');
      } else {
        const key = homeTutorialKey(uid ?? undefined);
        await AsyncStorage.setItem(key, '1');
      }
    } catch (e) {
      console.warn('failed to store home tutorial seen', e);
    } finally {
      setHomeTutorialVisible(false);
      setHomeTutorialStep(0);
      setHomeTutorialTeamId(null);
    }
  }

  const buildHomeTutorialBody = () => {
    // fallback (not used now). kept for compatibility.
    return [
      'This is the Home screen — quick tour:',
      '',
      '- Top: shows your team name and location when you are in a team.',
      '- Kit: view your team\'s home and away colours to confirm your kit.',
    ].join('\n');
  };

  // Short helper: is account just created (within minutes)
  function accountCreatedRecently(minutes = 10) {
    try {
      const meta = (auth as any)?.currentUser?.metadata;
      const creation = meta?.creationTime ?? null;
      if (!creation) return false;
      const createdAt = Date.parse(creation);
      if (isNaN(createdAt)) return false;
      return Date.now() - createdAt <= minutes * 60 * 1000;
    } catch {
      return false;
    }
  }

  // Show new-account tutorial if user has no team and account was just created and not seen before
  useEffect(() => {
    let mounted = true;
    async function maybeShow() {
      try {
        const uid = auth?.currentUser?.uid ?? null;
        if (!uid) return;
        // only for users with no team
        if (userData?.teamId) return;
        // don't show if already seen
        const seen = await AsyncStorage.getItem(newAccountTutorialKey(uid));
        if (seen) return;
        // require account recently created
        if (!accountCreatedRecently(10)) return;
        if (!mounted) return;
        setNewAccountTutorialVisible(true);
      } catch (e) {
        console.warn('new-account tutorial check failed', e);
      }
    }
    maybeShow();
    return () => { mounted = false; };
  }, [userData?.teamId, auth?.currentUser?.uid]);

  // Persist that user saw the new-account tutorial
  async function closeNewAccountTutorial() {
    try {
      const uid = auth?.currentUser?.uid ?? null;
      const key = newAccountTutorialKey(uid ?? undefined);
      await AsyncStorage.setItem(key, '1');
    } catch (e) {
      console.warn('failed to store new-account tutorial seen', e);
    } finally {
      setNewAccountTutorialVisible(false);
    }
  }

  const newAccountTutorialStep = {
    title: 'Welcome — get started',
    body:
      'You can either create a new team now (Create Team) or search for an existing team to join (Find a Team).\n\n' +
      '- Create Team: build your team, invite teammates, and schedule games.\n' +
      '- Find a Team: search public teams, request to join, and contact coordinators.\n\n' +
      'Tip: If you are going to run the team, choose Create Team. Otherwise try Find a Team first.',
    size: 'small' as const,
    primaryLabel: 'Got it',
  };

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
      // show both Create Team and Find a Team when user has no team
      return (
        <View style={{ width: '100%', alignItems: 'center' }}>
          <View style={{ width: '60%', marginBottom: 10 }}>
            <Button title="Create Team" onPress={() => router.push('/(tabs)/CreateTeamScreen')} />
          </View>
          <View style={{ width: '60%' }}>
            <Button title="Find a Team" onPress={() => router.push('/(tabs)/FindATeam')} />
          </View>
        </View>
      );
    }
    if (userData?.isCoordinator) {
      return <Button title="Manage Team" onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')} />;
    }
    return <Button title="Join Team" onPress={() => router.push('/(tabs)/FindATeam')} />;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
      {/* New-account tutorial modal (one-shot) */}
      {newAccountTutorialVisible && (
        <TutorialModal
          visible={newAccountTutorialVisible}
          onClose={closeNewAccountTutorial}
          onPrimary={closeNewAccountTutorial}
          primaryLabel={newAccountTutorialStep.primaryLabel}
          size={newAccountTutorialStep.size}
          title={newAccountTutorialStep.title}
          body={newAccountTutorialStep.body}
        />
      )}

      {/* existing home tutorial / other UI */}
      {homeTutorialVisible && (
        <TutorialModal
          visible={homeTutorialVisible}
          onClose={async () => {
            try {
              const uid = auth?.currentUser?.uid ?? null;
              const key = homeTutorialKey(uid ?? undefined);
              await AsyncStorage.setItem(key, '1');
            } catch {}
            setHomeTutorialVisible(false);
            setHomeTutorialStep(0);
          }}
          onPrimary={handleTutorialPrimary}
          primaryLabel={homeTutorialSteps[homeTutorialStep]?.primaryLabel ?? 'Got it'}
          size={homeTutorialSteps[homeTutorialStep]?.size ?? 'small'}
          title={homeTutorialSteps[homeTutorialStep]?.title}
          body={homeTutorialSteps[homeTutorialStep]?.body}
        />
      )}

      {/* User Info Section */}
      {user && (
        <View style={styles.userInfoBox}>
          <Text style={styles.userInfoTitle}>Signed in as</Text>
          <Text style={styles.userName}>{userData?.name || user.displayName || 'User'}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          {userData?.teamId && (
            <View style={styles.userStatusBadge}>
              <Text style={styles.userStatusText}>
                {userData?.isCoordinator ? '👔 Coordinator' : '👤 Team Member'}
              </Text>
            </View>
          )}
        </View>
      )}

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

  /* User Info styles */
  userInfoBox: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f0f9ff',
    borderColor: '#0a7ea4',
    borderWidth: 2,
    marginBottom: 20,
    alignItems: 'center',
  },
  userInfoTitle: {
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  userStatusBadge: {
    backgroundColor: '#0a7ea4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 8,
  },
  userStatusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
