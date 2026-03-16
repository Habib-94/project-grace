import { useAuth } from '@/context/AuthContext';
import { onAppEvent } from '@/src/appEvents';
import TutorialModal from '@/src/components/TutorialModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from '@react-native-firebase/firestore';
import { useIsFocused } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const db = getFirestore();

// ─── Tutorial steps ────────────────────────────────────────────────────────────

const HOME_TUTORIAL_STEPS = [
  { title: 'Welcome to Home', body: 'This screen shows your team at a glance. Tap the buttons to manage or create a team.', size: 'small' as const, primaryLabel: 'Next' },
  { title: 'Kit & Role', body: "See your team kit colours and whether you are a Coordinator or Member. Coordinators can schedule games.", size: 'small' as const, primaryLabel: 'Next' },
  { title: 'Requests & Actions', body: 'Preview pending requests, manage them from the Manage Team screen, or use Find Games to discover matches.', size: 'small' as const, primaryLabel: 'Got it' },
];

const NEW_ACCOUNT_TUTORIAL = {
  title: 'Welcome — get started',
  body: 'You can either create a new team now (Create Team) or search for an existing team to join (Find a Team).\n\n- Create Team: build your team, invite teammates, and schedule games.\n- Find a Team: search public teams, request to join, and contact coordinators.\n\nTip: If you are going to run the team, choose Create Team. Otherwise try Find a Team first.',
  size: 'small' as const,
  primaryLabel: 'Got it',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const isFocused = useIsFocused();

  const [userData, setUserData] = useState<Record<string, unknown> | null>(null);
  const [teamData, setTeamData] = useState<Record<string, unknown> | null>(null);
  const [gameRequests, setGameRequests] = useState<Record<string, unknown>[]>([]);
  const [loadingGameRequests, setLoadingGameRequests] = useState(false);
  const [loading, setLoading] = useState(true);
  const [homeTutorialVisible, setHomeTutorialVisible] = useState(false);
  const [homeTutorialStep, setHomeTutorialStep] = useState(0);
  const [newAccountTutorialVisible, setNewAccountTutorialVisible] = useState(false);

  const tutorialKey = user?.uid ? `tutorial_seen:${user.uid}:home` : null;
  const newAccountKey = user?.uid ? `tutorial_seen:${user.uid}:home:new_account` : null;

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchGameRequests = useCallback(async (teamId: string) => {
    setLoadingGameRequests(true);
    try {
      const snap = await getDocs(query(collection(db, 'gameRequests'), where('teamId', '==', teamId)));
      setGameRequests((snap.docs as Array<{ id: string; data(): Record<string, unknown> }>).map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.warn('[Home] fetchGameRequests failed', e);
      setGameRequests([]);
    } finally {
      setLoadingGameRequests(false);
    }
  }, []);

  const refreshUserAndTeam = useCallback(async () => {
    if (!user?.uid) { setUserData(null); setTeamData(null); setLoading(false); return; }
    try {
      setLoading(true);
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      if (!uSnap.exists) { setUserData(null); setTeamData(null); return; }
      const u = uSnap.data() as Record<string, unknown>;
      setUserData(u);
      if (u.teamId) {
        const tSnap = await getDoc(doc(db, 'teams', u.teamId as string));
        setTeamData(tSnap.data() != null ? { id: tSnap.id, ...tSnap.data() } : null);
      } else {
        setTeamData(null);
      }
    } catch (e) {
      console.warn('[Home] refreshUserAndTeam failed', e);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { refreshUserAndTeam(); }, [refreshUserAndTeam]);

  useEffect(() => {
    if (isFocused) {
      refreshUserAndTeam();
      if (teamData?.id && userData?.isCoordinator) fetchGameRequests(teamData.id as string);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  useEffect(() => {
    const subs = [
      onAppEvent('team:updated', refreshUserAndTeam),
      onAppEvent('team:left', () => { refreshUserAndTeam(); setGameRequests([]); }),
      onAppEvent('team:deleted', () => { refreshUserAndTeam(); setGameRequests([]); }),
    ];
    return () => { subs.forEach((u) => { try { if (typeof u === 'function') u(); } catch {} }); };
  }, [refreshUserAndTeam]);

  useEffect(() => {
    if (teamData?.id && userData?.isCoordinator) fetchGameRequests(teamData.id as string);
  }, [teamData?.id, userData?.isCoordinator, fetchGameRequests]);

  // ── Tutorials ──────────────────────────────────────────────────────────────

  // Home tutorial: show once when user has a team
  useEffect(() => {
    if (!tutorialKey || !teamData?.id) return;
    AsyncStorage.getItem(tutorialKey).then((seen) => { if (!seen) setHomeTutorialVisible(true); }).catch(console.warn);
  }, [tutorialKey, teamData?.id]);

  // New account tutorial: show once for users without a team who just signed up
  useEffect(() => {
    if (!newAccountKey || userData?.teamId) return;
    AsyncStorage.getItem(newAccountKey).then((seen) => {
      if (seen) return;
      try {
        const meta = (user as unknown as { metadata?: { creationTime?: string } })?.metadata;
        const createdAt = meta?.creationTime ? Date.parse(meta.creationTime) : 0;
        if (Date.now() - createdAt <= 10 * 60 * 1000) setNewAccountTutorialVisible(true);
      } catch {}
    }).catch(console.warn);
  }, [newAccountKey, userData?.teamId, user]);

  const dismissHomeTutorial = useCallback(async () => {
    try { if (tutorialKey) await AsyncStorage.setItem(tutorialKey, '1'); } catch {}
    setHomeTutorialVisible(false);
    setHomeTutorialStep(0);
  }, [tutorialKey]);

  const dismissNewAccountTutorial = useCallback(async () => {
    try { if (newAccountKey) await AsyncStorage.setItem(newAccountKey, '1'); } catch {}
    setNewAccountTutorialVisible(false);
  }, [newAccountKey]);

  // ── Auth ───────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error('[Home] logout failed', e);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const homeColor = (teamData?.homeColor as string) || '#0a7ea4';
  const awayColor = (teamData?.awayColor as string) || '#ffffff';

  const Jersey = ({ color, label }: { color: string; label: string }) => (
    <View style={styles.jerseyContainer}>
      <ExpoImage source={require('@/assets/images/jersey_fill.png')} style={[styles.jerseyFill, { tintColor: color }]} contentFit="contain" />
      <ExpoImage source={require('@/assets/images/jersey_outline.png')} style={styles.jerseyOutline} contentFit="contain" />
      <Text style={styles.jerseyLabel}>{label}</Text>
    </View>
  );

  const renderRoleButton = () => {
    if (!userData?.teamId) {
      return (
        <View style={styles.roleButtonGroup}>
          <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/CreateTeamScreen')}>
            <Text style={styles.buttonText}>Create Team</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/(tabs)/FindATeam')}>
            <Text style={styles.buttonText}>Find a Team</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (userData?.isCoordinator) {
      return (
        <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')}>
          <Text style={styles.buttonText}>Manage Team</Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity style={styles.button} onPress={() => router.push('/(tabs)/FindATeam')}>
        <Text style={styles.buttonText}>Join Team</Text>
      </TouchableOpacity>
    );
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0a7ea4" />
        <Text style={styles.loadingText}>Loading your team...</Text>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.containerContent}>
      {newAccountTutorialVisible && (
        <TutorialModal
          visible={newAccountTutorialVisible}
          onClose={dismissNewAccountTutorial}
          onPrimary={dismissNewAccountTutorial}
          primaryLabel={NEW_ACCOUNT_TUTORIAL.primaryLabel}
          size={NEW_ACCOUNT_TUTORIAL.size}
          title={NEW_ACCOUNT_TUTORIAL.title}
          body={NEW_ACCOUNT_TUTORIAL.body}
        />
      )}

      {homeTutorialVisible && (
        <TutorialModal
          visible={homeTutorialVisible}
          onClose={dismissHomeTutorial}
          onPrimary={async () => {
            if (homeTutorialStep < HOME_TUTORIAL_STEPS.length - 1) { setHomeTutorialStep((s) => s + 1); return; }
            await dismissHomeTutorial();
          }}
          primaryLabel={HOME_TUTORIAL_STEPS[homeTutorialStep]?.primaryLabel ?? 'Got it'}
          size={HOME_TUTORIAL_STEPS[homeTutorialStep]?.size ?? 'small'}
          title={HOME_TUTORIAL_STEPS[homeTutorialStep]?.title}
          body={HOME_TUTORIAL_STEPS[homeTutorialStep]?.body}
        />
      )}

      {user && (
        <View style={styles.userInfoBox}>
          <Text style={styles.userInfoTitle}>Signed in as</Text>
          <Text style={styles.userName}>{(userData?.name as string) || user.displayName || 'User'}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          {!!userData?.teamId && (
            <View style={styles.userStatusBadge}>
              <Text style={styles.userStatusText}>{userData?.isCoordinator ? '👔 Coordinator' : '👤 Team Member'}</Text>
            </View>
          )}
        </View>
      )}

      {teamData ? (
        <>
          <Text style={styles.teamName}>{teamData.teamName as string}</Text>
          <Text style={styles.location}>{teamData.location as string}</Text>

          <View style={styles.kitRow}>
            <Jersey color={homeColor} label="Home" />
            <Jersey color={awayColor} label="Away" />
          </View>

          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>Your Team Summary</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Role:</Text>
              <Text style={styles.summaryValue}>{userData?.isCoordinator ? 'Coordinator' : 'Member'}</Text>
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

          <View style={[styles.summaryBox, styles.requestsBox]}>
            <Text style={styles.summaryTitle}>Pending game requests</Text>
            {loadingGameRequests ? (
              <ActivityIndicator size="small" color="#0a7ea4" />
            ) : gameRequests.length === 0 ? (
              <Text style={styles.emptyRequests}>No pending game requests</Text>
            ) : (
              <>
                {gameRequests.slice(0, 4).map((r) => (
                  <View key={r.id as string} style={styles.requestItem}>
                    <Text style={styles.requestTeam}>{(r.requestingTeamName ?? r.requestingTeamId ?? 'Team') as string}</Text>
                    <Text style={styles.requestTitle}>{(r.title ?? 'Game request') as string}</Text>
                    {r.startISO ? <Text style={styles.requestTime}>{new Date(r.startISO as string).toLocaleString()}</Text> : null}
                  </View>
                ))}
                {gameRequests.length > 4 && <Text style={styles.moreRequests}>{gameRequests.length} total</Text>}
                <View style={styles.manageRow}>
                  <Pressable onPress={() => router.push('/(tabs)/CoordinatorDashboardScreen')} style={styles.outlineButton}>
                    <Text style={styles.outlineButtonText}>Manage requests</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.noTeamText}>You haven't created or joined a team yet.</Text>
      )}

      <View style={styles.actionButtons}>{renderRoleButton()}</View>
      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, color: '#444' },
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
  summaryBox: { width: '100%', padding: 16, borderRadius: 8, backgroundColor: '#f7fbfd', borderColor: '#e6f2f6', borderWidth: 1, marginTop: 10 },
  requestsBox: { marginTop: 12 },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: '#0a7ea4', marginBottom: 10, textAlign: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { fontSize: 14, color: '#333', fontWeight: '600' },
  summaryValue: { fontSize: 14, color: '#333' },
  swatches: { flexDirection: 'row', gap: 16 },
  swatchItem: { alignItems: 'center', marginLeft: 8 },
  kitSwatch: { width: 34, height: 34, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  swatchLabel: { marginTop: 6, fontSize: 12, color: '#333' },
  emptyRequests: { color: '#666', textAlign: 'center' },
  requestItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  requestTeam: { fontWeight: '600' },
  requestTitle: { color: '#666' },
  requestTime: { color: '#666', fontSize: 12 },
  moreRequests: { color: '#666', marginTop: 8 },
  manageRow: { marginTop: 8, alignItems: 'center' },
  outlineButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 4, borderWidth: 1, borderColor: '#0a7ea4' },
  outlineButtonText: { fontSize: 14, fontWeight: '500', color: '#0a7ea4', textAlign: 'center' },
  actionButtons: { marginTop: 20, width: '60%' },
  roleButtonGroup: { width: '100%', alignItems: 'center', gap: 8 },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center', width: '100%', marginVertical: 4 },
  secondaryButton: { backgroundColor: '#555' },
  logoutButton: { backgroundColor: '#FF3B30', marginTop: 10, width: '60%' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  userInfoBox: { width: '100%', padding: 16, borderRadius: 12, backgroundColor: '#f0f9ff', borderColor: '#0a7ea4', borderWidth: 2, marginBottom: 20, alignItems: 'center' },
  userInfoTitle: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  userName: { fontSize: 20, fontWeight: '700', color: '#0a7ea4', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#555', marginBottom: 8 },
  userStatusBadge: { backgroundColor: '#0a7ea4', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 8 },
  userStatusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
