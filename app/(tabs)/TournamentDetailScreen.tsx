import { useAuth } from '@/context/AuthContext';
import { haversineDistanceKm } from '@/src/locations';
import type { Tournament, TournamentMatch, TournamentTeamEntry } from '@/src/types/firestore';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch
} from '@react-native-firebase/firestore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';

const db = getFirestore();
const KM_TO_MILES = 0.621371;

// ─── Bracket generation helpers ───────────────────────────────────────────────

/** Seed teams by ELO descending, pair 1st vs last etc.
 *  knockoutLegs = 1 (single game), 3 (best-of-3), 5 (best-of-5).
 *  Home/away alternates each leg.
 *
 *  BYE logic (odd team count):
 *   - The lowest-ELO team is NEVER eligible for a BYE.
 *   - A BYE recipient is chosen randomly from the remaining teams.
 *   - After the BYE is assigned the rest are re-seeded and paired highest vs lowest.
 *
 *  Adaptive bracket: works for any team count ≥ 2, regardless of maxTeams.
 */
function generateKnockoutRound1(teams: TournamentTeamEntry[], knockoutLegs: 1 | 3 | 5 = 1): Omit<TournamentMatch, 'id'>[] {
  const seeded = [...teams].sort((a, b) => b.elo - a.elo); // index 0 = highest ELO
  const matches: Omit<TournamentMatch, 'id'>[] = [];

  // Determine which teams actually play in round 1
  let playingTeams = seeded;

  if (seeded.length % 2 !== 0) {
    // All teams except the last (lowest ELO) are eligible for the BYE
    const eligibleForBye = seeded.slice(0, seeded.length - 1);
    const byeIdx = Math.floor(Math.random() * eligibleForBye.length);
    const byeTeam = eligibleForBye[byeIdx]!;

    // BYE match — already marked completed so the team auto-advances
    matches.push({
      tournamentId: '',
      round: 1,
      matchNumber: Math.ceil(seeded.length / 2), // last slot in the round
      homeTeamId: byeTeam.teamId,
      homeTeamName: byeTeam.teamName,
      awayTeamId: null,
      awayTeamName: 'BYE',
      status: 'completed',
      homeScore: 1,
      awayScore: 0,
      winnerId: byeTeam.teamId,
      gameId: null,
      startISO: null,
      venueName: null,
    });

    // Remove the BYE team and re-seed the rest
    playingTeams = seeded.filter((t) => t.teamId !== byeTeam.teamId);
  }

  // Pair remaining teams: highest seed vs lowest seed
  const m = playingTeams.length;
  for (let i = 0; i < m / 2; i++) {
    const teamA = playingTeams[i]!;          // higher seed
    const teamB = playingTeams[m - 1 - i]!; // lower seed
    for (let leg = 1; leg <= knockoutLegs; leg++) {
      const home = leg % 2 === 1 ? teamA : teamB;
      const away = leg % 2 === 1 ? teamB : teamA;
      matches.push({
        tournamentId: '',
        round: 1,
        matchNumber: i + 1,
        ...(knockoutLegs > 1 ? { legNumber: leg, totalLegs: knockoutLegs } : {}),
        homeTeamId: home.teamId,
        homeTeamName: home.teamName,
        awayTeamId: away.teamId,
        awayTeamName: away.teamName,
        status: 'pending',
        homeScore: null,
        awayScore: null,
        winnerId: null,
        gameId: null,
        startISO: null,
        venueName: null,
      });
    }
  }

  return matches;
}

/** Divide teams into groups (snake-seeded by ELO), round-robin within each group.
 *  legsPerPairing = how many times each pair plays (1, 2 or 3).
 *  Home/away alternates on even legs. */
function generateGroupStageMatches(teams: TournamentTeamEntry[], legsPerPairing: 1 | 2 | 3 = 1, groupSize = 4): Omit<TournamentMatch, 'id'>[] {
  const seeded = [...teams].sort((a, b) => b.elo - a.elo);
  const groupCount = Math.ceil(seeded.length / groupSize);
  const groups: TournamentTeamEntry[][] = Array.from({ length: groupCount }, () => []);
  seeded.forEach((t, i) => groups[i % groupCount]!.push(t));

  const matches: Omit<TournamentMatch, 'id'>[] = [];
  let matchNum = 1;

  groups.forEach((group, gi) => {
    const groupLabel = String.fromCharCode(65 + gi);
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const teamA = group[a]!;
        const teamB = group[b]!;
        for (let leg = 1; leg <= legsPerPairing; leg++) {
          const home = leg % 2 === 1 ? teamA : teamB;
          const away = leg % 2 === 1 ? teamB : teamA;
          matches.push({
            tournamentId: '',
            round: 1,
            matchNumber: matchNum,
            group: groupLabel,
            ...(legsPerPairing > 1 ? { legNumber: leg, totalLegs: legsPerPairing } : {}),
            homeTeamId: home.teamId,
            homeTeamName: home.teamName,
            awayTeamId: away.teamId,
            awayTeamName: away.teamName,
            status: 'pending',
            homeScore: null,
            awayScore: null,
            winnerId: null,
            gameId: null,
            startISO: null,
            venueName: null,
          });
        }
        matchNum++;
      }
    }
  });
  return matches;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TournamentDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userTeamId, setUserTeamId] = useState('');
  const [userTeamName, setUserTeamName] = useState('');
  const [userTeamElo, setUserTeamElo] = useState(1500);
  const [userTeamLat, setUserTeamLat] = useState<number | null>(null);
  const [userTeamLng, setUserTeamLng] = useState<number | null>(null);
  const [isCoordinator, setIsCoordinator] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [startingTournament, setStartingTournament] = useState(false);
  const [scoreModal, setScoreModal] = useState<{ match: TournamentMatch } | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'teams' | 'bracket'>('info');
  // Multi-venue sign-up preference modal
  const [signUpModalVisible, setSignUpModalVisible] = useState(false);
  const [preferredDay, setPreferredDay] = useState<number>(6); // 6 = Saturday default
  const [preferredTime, setPreferredTime] = useState('15:00');

  // Load user/team data
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const uSnap = await getDoc(doc(db, 'users', user.uid));
        if (!uSnap.exists) return;
        const ud = uSnap.data() as Record<string, unknown>;
        setIsCoordinator(!!(ud.isCoordinator));
        if (ud.teamId) {
          setUserTeamId(ud.teamId as string);
          const tSnap = await getDoc(doc(db, 'teams', ud.teamId as string));
          if (tSnap.exists()) {
            const td = tSnap.data() as Record<string, unknown>;
            setUserTeamName((td.teamName as string) ?? '');
            setUserTeamElo((td.elo as number) ?? 1500);
            setUserTeamLat((td.latitude as number) ?? null);
            setUserTeamLng((td.longitude as number) ?? null);
          }
        }
      } catch (e) { console.warn('[TournamentDetail] load user failed', e); }
    })();
  }, [user?.uid]);

  const fetchData = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
      if (!tSnap.exists) { Toast.show({ type: 'error', text1: 'Tournament not found' }); router.back(); return; }
      setTournament({ id: tSnap.id, ...tSnap.data() as Omit<Tournament, 'id'> });

      const mSnap = await getDocs(
        query(collection(db, 'tournaments', tournamentId, 'matches'), where('round', '>=', 1))
      );
      const mDocs = (mSnap.docs as Array<{ id: string; data(): Record<string, unknown> }>).map(
        (d) => ({ id: d.id, ...d.data() } as TournamentMatch)
      ).sort((a, b) => a.round !== b.round ? a.round - b.round : a.matchNumber - b.matchNumber);
      setMatches(mDocs);
    } catch (e) {
      console.warn('[TournamentDetail] fetchData failed', e);
      Toast.show({ type: 'error', text1: 'Failed to load tournament' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tournamentId, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Sign-up eligibility check ───────────────────────────────────────────────
  const canSignUp = (): { ok: boolean; reason?: string } => {
    if (!tournament) return { ok: false, reason: 'No tournament loaded' };
    if (tournament.status !== 'open') return { ok: false, reason: 'Tournament is not open for sign-ups' };
    if (!isCoordinator) return { ok: false, reason: 'Only team coordinators can sign up' };
    if (!userTeamId) return { ok: false, reason: 'You need a team to sign up' };
    if (tournament.teams.some((t) => t.teamId === userTeamId)) return { ok: false, reason: 'Your team is already signed up' };
    if (tournament.teams.length >= tournament.maxTeams) return { ok: false, reason: 'Tournament is full' };

    // ELO gate
    if (tournament.eloMin != null && userTeamElo < tournament.eloMin)
      return { ok: false, reason: `Your team ELO (${userTeamElo}) is below the minimum (${tournament.eloMin})` };
    if (tournament.eloMax != null && userTeamElo > tournament.eloMax)
      return { ok: false, reason: `Your team ELO (${userTeamElo}) is above the maximum (${tournament.eloMax})` };

    // Location gate
    if (tournament.locationRadiusMiles != null && tournament.locationGateLat != null && tournament.locationGateLng != null) {
      if (userTeamLat == null || userTeamLng == null)
        return { ok: false, reason: 'Your team has no location set — cannot verify location restriction' };
      const dist = haversineDistanceKm(userTeamLat, userTeamLng, tournament.locationGateLat, tournament.locationGateLng) * KM_TO_MILES;
      if (dist > tournament.locationRadiusMiles)
        return { ok: false, reason: `Your team is ${dist.toFixed(1)} mi from the tournament area (max ${tournament.locationRadiusMiles} mi)` };
    }

    return { ok: true };
  };

  const handleSignUp = () => {
    const check = canSignUp();
    if (!check.ok) { Toast.show({ type: 'error', text1: check.reason ?? 'Cannot sign up' }); return; }
    // For multi-venue tournaments ask for home game day/time preference
    if (tournament?.venueType === 'multi') {
      setSignUpModalVisible(true);
    } else {
      confirmSignUp();
    }
  };

  const confirmSignUp = async (day?: number, time?: string) => {
    setSignUpModalVisible(false);
    setSigningUp(true);
    try {
      const entry: TournamentTeamEntry = {
        teamId: userTeamId,
        teamName: userTeamName,
        elo: userTeamElo,
        signedUpAt: new Date().toISOString(),
        ...(userTeamLat != null ? { latitude: userTeamLat } : {}),
        ...(userTeamLng != null ? { longitude: userTeamLng } : {}),
        ...(day != null ? { preferredDay: day } : {}),
        ...(time ? { preferredTime: time } : {}),
      };
      const updatedTeams = [...(tournament!.teams ?? []), entry];
      await updateDoc(doc(db, 'tournaments', tournamentId!), { teams: updatedTeams });
      Toast.show({ type: 'success', text1: 'Signed up!', text2: `${userTeamName} has joined the tournament.` });
      fetchData();
    } catch (e) {
      console.error('[TournamentDetail] signUp failed', e);
      Toast.show({ type: 'error', text1: 'Sign up failed' });
    } finally {
      setSigningUp(false);
    }
  };

  const handleWithdraw = async () => {
    if (!tournament || tournament.hostTeamId === userTeamId) {
      Toast.show({ type: 'info', text1: 'Host cannot withdraw — cancel the tournament instead' }); return;
    }
    Alert.alert('Withdraw', 'Remove your team from this tournament?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: async () => {
          try {
            const updatedTeams = tournament.teams.filter((t) => t.teamId !== userTeamId);
            await updateDoc(doc(db, 'tournaments', tournamentId!), { teams: updatedTeams });
            Toast.show({ type: 'info', text1: 'Withdrawn from tournament' });
            fetchData();
          } catch {
            Toast.show({ type: 'error', text1: 'Withdraw failed' });
          }
        },
      },
    ]);
  };

  // ── Start tournament (generate bracket) ────────────────────────────────────
  const handleStartTournament = async () => {
    if (!tournament) return;
    if (tournament.teams.length < 2) { Toast.show({ type: 'error', text1: 'Need at least 2 teams to start' }); return; }

    Alert.alert(
      'Start Tournament',
      `Generate the ${tournament.format === 'knockout' ? 'knockout bracket' : 'group stage'} for ${tournament.teams.length} teams? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start', onPress: async () => {
            setStartingTournament(true);
            try {
              const matchTemplates = tournament.format === 'knockout'
                ? generateKnockoutRound1(tournament.teams, tournament.knockoutLegs ?? 1)
                : generateGroupStageMatches(tournament.teams, tournament.groupLegsPerPairing ?? 1);

              const batch = writeBatch(db);

              // Write each match
              for (const m of matchTemplates) {
                const mRef = doc(collection(db, 'tournaments', tournamentId!, 'matches'));
                batch.set(mRef, { ...m, tournamentId });
              }

              // If multi-venue, also create game documents from home team's available slots
              if (tournament.venueType === 'multi') {
                for (const m of matchTemplates) {
                  if (!m.homeTeamId || !m.awayTeamId || m.awayTeamName === 'BYE') continue;
                  // Query only on teamId to avoid composite index requirement; filter rest client-side
                  const slotsSnap = await getDocs(query(
                    collection(db, 'games'),
                    where('teamId', '==', m.homeTeamId)
                  ));
                  type GameSlot = { id: string; startISO: unknown; location: unknown; type: unknown };
                  const slots = (slotsSnap.docs as Array<{ id: string; data(): Record<string, unknown> }>)
                    .map((d): GameSlot => ({ id: d.id, startISO: d.data().startISO, location: d.data().location, type: d.data().type }))
                    .filter(s =>
                      s.type === 'open' &&
                      typeof s.startISO === 'string' &&
                      s.startISO >= tournament.startDate &&
                      s.startISO <= tournament.endDate
                    )
                    .sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

                  const slot = slots[0];
                  if (slot) {
                    // Mark that slot as a tournament match
                    const gameRef = doc(db, 'games', slot.id);
                    batch.update(gameRef, {
                      tournamentId,
                      tournamentMatchHomeTeamId: m.homeTeamId,
                      tournamentMatchAwayTeamId: m.awayTeamId,
                      tournamentMatchAwayTeamName: m.awayTeamName,
                      type: 'tournament',
                    });
                    m.gameId = slot.id;
                    m.startISO = slot.startISO as string;
                    m.venueName = (slot.location as Record<string, unknown> | null)?.label as string ?? null;
                  }
                }
              } else if (tournament.venueType === 'single') {
                // For single venue, create placeholder game docs at the tournament venue
                for (const m of matchTemplates) {
                  if (!m.homeTeamId || !m.awayTeamId || m.awayTeamName === 'BYE') continue;
                  const gamePayload = {
                    tournamentId,
                    type: 'tournament',
                    teamId: m.homeTeamId,
                    teamName: m.homeTeamName,
                    title: `${m.homeTeamName} vs ${m.awayTeamName}`,
                    opponentTeamId: m.awayTeamId,
                    opponentTeamName: m.awayTeamName,
                    location: tournament.venueName ?? null,
                    latitude: tournament.venueLatitude ?? null,
                    longitude: tournament.venueLongitude ?? null,
                    startISO: null, // Host to schedule after bracket generated
                    status: 'pending',
                    createdAt: serverTimestamp(),
                    createdBy: user!.uid,
                  };
                  const gRef = doc(collection(db, 'games'));
                  batch.set(gRef, gamePayload);
                  m.gameId = gRef.id;
                  m.venueName = tournament.venueName ?? null;
                }
              }

              // Update tournament status
              const tournRef = doc(db, 'tournaments', tournamentId!);
              batch.update(tournRef, { status: 'in_progress' });

              await batch.commit();
              Toast.show({ type: 'success', text1: 'Tournament started!', text2: 'Bracket/groups generated.' });
              fetchData();
              setActiveTab('bracket');
            } catch (e) {
              console.error('[TournamentDetail] startTournament failed', e);
              Toast.show({ type: 'error', text1: 'Failed to start tournament' });
            } finally {
              setStartingTournament(false);
            }
          },
        },
      ]
    );
  };

  // ── Submit match result ─────────────────────────────────────────────────────
  const handleSubmitResult = async (match: TournamentMatch, homeScore: number, awayScore: number) => {
    if (!tournamentId) return;
    const winnerId = homeScore > awayScore
      ? match.homeTeamId
      : awayScore > homeScore
        ? match.awayTeamId
        : null; // draw — for now no winner on draw

    try {
      await updateDoc(doc(db, 'tournaments', tournamentId, 'matches', match.id), {
        homeScore,
        awayScore,
        winnerId,
        status: 'completed',
      });

      // Check if all matches in this round are done → generate next round for knockout
      if (tournament?.format === 'knockout') {
        const roundMatches = matches.filter((m) => m.round === match.round);

        // Build the effective winner ID for every match in the round
        // (use the just-submitted match's resolved winnerId for the current match)
        const resolvedWinnerIds = roundMatches
          .map((m) => (m.id === match.id ? winnerId : m.winnerId))
          .filter((id): id is string => !!id); // drop nulls (draws / incomplete)

        // All matches must be completed (and non-null winners) before advancing
        const allDone = roundMatches.every((m) => m.id === match.id || m.status === 'completed');
        const allHaveWinners = resolvedWinnerIds.length === roundMatches.length;

        if (allDone && allHaveWinners) {
          // De-duplicate winners (safety net — each teamId should appear at most once)
          const uniqueWinnerIds = [...new Set(resolvedWinnerIds)];

          // Resolve to TournamentTeamEntry objects
          const winners = uniqueWinnerIds
            .map((id) => tournament.teams.find((t) => t.teamId === id) ?? null)
            .filter(Boolean) as TournamentTeamEntry[];

          if (winners.length >= 2) {
            const nextRound = match.round + 1;
            // Subsequent rounds are always single-leg (the legs setting only applies to round 1)
            const nextMatches = generateKnockoutRound1(winners, 1).map((m) => ({ ...m, round: nextRound }));
            const batch = writeBatch(db);
            for (const nm of nextMatches) {
              const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));
              batch.set(ref, { ...nm, tournamentId });
            }
            await batch.commit();
            Toast.show({ type: 'success', text1: `Round ${nextRound} generated!` });
          } else if (winners.length === 1) {
            const champion = winners[0]!;
            await updateDoc(doc(db, 'tournaments', tournamentId!), {
              status: 'completed',
              winnerId: champion.teamId,
              winnerName: champion.teamName,
            });
            Toast.show({ type: 'success', text1: '🏆 Tournament complete!', text2: `Winner: ${champion.teamName}` });
          }
        }
      }

      setScoreModal(null);
      fetchData();
    } catch (e) {
      console.error('[TournamentDetail] submitResult failed', e);
      Toast.show({ type: 'error', text1: 'Failed to save result' });
    }
  };

  // ── Renders ─────────────────────────────────────────────────────────────────

  const isHost = tournament?.hostUserId === user?.uid;
  const signedUp = tournament?.teams.some((t) => t.teamId === userTeamId) ?? false;
  const signUpCheck = canSignUp();

  const renderInfoTab = () => (
    <View>
      {tournament?.description ? <Text style={styles.description}>{tournament.description}</Text> : null}

      <View style={styles.infoGrid}>
        <InfoRow label="Format" value={tournament?.format === 'knockout' ? '🏆 Knockout' : '🔵 Group + Playoff'} />
        <InfoRow label="Venue" value={tournament?.venueType === 'single'
          ? `📍 Single — ${tournament.venueName ?? 'TBD'}`
          : '🏟️ Home/Away venues'} />
        <InfoRow label="Teams" value={`${tournament?.teams.length ?? 0} / ${tournament?.maxTeams}`} />
        <InfoRow label="Window" value={`${new Date(tournament?.startDate ?? '').toLocaleDateString()} → ${new Date(tournament?.endDate ?? '').toLocaleDateString()}`} />
        {(tournament?.eloMin != null || tournament?.eloMax != null) && (
          <InfoRow label="ELO Range" value={`${tournament?.eloMin ?? '—'} – ${tournament?.eloMax ?? '—'}`} />
        )}
        {tournament?.locationGateLabel && (
          <InfoRow label="Location Gate" value={`${tournament.locationGateLabel}${tournament.locationRadiusMiles ? ` (${tournament.locationRadiusMiles} mi radius)` : ''}`} />
        )}
        {tournament?.format === 'knockout' && (tournament.knockoutLegs ?? 1) > 1 && (
          <InfoRow label="Series Format" value={`Best of ${tournament.knockoutLegs}`} />
        )}
        {tournament?.format === 'group_playoff' && (tournament.groupLegsPerPairing ?? 1) > 1 && (
          <InfoRow label="Group Legs" value={`${tournament.groupLegsPerPairing} games per pairing`} />
        )}
      </View>

      {/* Sign-up / withdraw / start controls */}
      {tournament?.status === 'open' && !isHost && (
        signedUp ? (
          <TouchableOpacity style={[styles.actionButton, styles.withdrawButton]} onPress={handleWithdraw}>
            <Text style={styles.actionButtonText}>Withdraw Team</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, (!signUpCheck.ok || signingUp) && styles.actionButtonDisabled]}
            onPress={handleSignUp}
            disabled={!signUpCheck.ok || signingUp}
          >
            {signingUp
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.actionButtonText}>Sign Up My Team</Text>
            }
          </TouchableOpacity>
        )
      )}
      {!signUpCheck.ok && !signedUp && tournament?.status === 'open' && !isHost && (
        <Text style={styles.eligibilityNote}>{signUpCheck.reason}</Text>
      )}

      {isHost && tournament?.status === 'open' && (
        <TouchableOpacity
          style={[styles.actionButton, styles.startButton, (startingTournament || (tournament?.teams.length ?? 0) < 2) && styles.actionButtonDisabled]}
          onPress={handleStartTournament}
          disabled={startingTournament || (tournament?.teams.length ?? 0) < 2}
        >
          {startingTournament
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.actionButtonText}>🏁 Start Tournament & Generate Bracket</Text>
          }
        </TouchableOpacity>
      )}
      {isHost && tournament?.status === 'open' && (tournament?.teams.length ?? 0) < 2 && (
        <Text style={styles.eligibilityNote}>Need at least 2 teams to start.</Text>
      )}
    </View>
  );

  const renderTeamsTab = () => (
    <FlatList
      data={tournament?.teams ?? []}
      keyExtractor={(t) => t.teamId}
      scrollEnabled={false}
      ListEmptyComponent={<Text style={styles.emptyText}>No teams signed up yet.</Text>}
      renderItem={({ item, index }) => (
        <View style={styles.teamRow}>
          <View style={styles.teamSeed}><Text style={styles.teamSeedText}>{index + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.teamRowName}>{item.teamName}</Text>
            <Text style={styles.teamRowElo}>ELO: {item.elo}</Text>
          </View>
          {item.teamId === tournament?.hostTeamId && (
            <View style={styles.hostBadge}><Text style={styles.hostBadgeText}>Host</Text></View>
          )}
        </View>
      )}
    />
  );

  const renderBracketTab = () => {
    if (matches.length === 0) {
      return <Text style={styles.emptyText}>Bracket will appear once the tournament starts.</Text>;
    }

    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
    const maxRound = Math.max(...rounds);

    return (
      <View>
        {rounds.map((round) => {
          const roundMatches = matches.filter((m) => m.round === round);
          const groups = [...new Set(roundMatches.map((m) => m.group))].filter(Boolean);
          const isGroupStage = groups.length > 0;

          // Group legs into series by matchNumber
          const slotMap = new Map<number, TournamentMatch[]>();
          roundMatches.forEach((m) => {
            const list = slotMap.get(m.matchNumber) ?? [];
            list.push(m);
            slotMap.set(m.matchNumber, list);
          });
          const slots = [...slotMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, legs]) => legs.sort((a, b) => (a.legNumber ?? 1) - (b.legNumber ?? 1)));

          const uniqueSlotCount = slotMap.size;
          return (
            <View key={round} style={styles.roundSection}>
              <Text style={styles.roundTitle}>
                {tournament?.format === 'knockout'
                  ? round === maxRound && uniqueSlotCount === 1
                    ? '🏆 Final'
                    : round === maxRound - 1 && uniqueSlotCount === 2
                      ? 'Semi-Finals'
                      : `Round ${round}`
                  : round === 1 ? 'Group Stage' : `Playoff Round ${round - 1}`
                }
              </Text>
              {isGroupStage
                ? groups.map((g) => (
                    <View key={g}>
                      <Text style={styles.groupLabel}>Group {g}</Text>
                      {slots
                        .filter((s) => s[0]?.group === g)
                        .map((legs) => renderSeriesCard(legs, true))}
                    </View>
                  ))
                : slots.map((legs) => renderSeriesCard(legs, false))
              }
            </View>
          );
        })}
      </View>
    );
  };

  const renderSeriesCard = (legs: TournamentMatch[], isGroupStage: boolean) => {
    if (!legs.length) return null;
    const firstLeg = legs[0]!;
    const isBye = firstLeg.awayTeamName === 'BYE';
    const totalLegs = firstLeg.totalLegs ?? 1;
    const isMultiLeg = totalLegs > 1;

    // Knockout series winner = the leg with a non-null winnerId (the deciding leg)
    const decidingLeg = !isGroupStage ? legs.find((l) => l.status === 'completed' && l.winnerId) : null;
    const seriesWinnerId = decidingLeg?.winnerId ?? null;

    // Cumulative wins for series header display
    let homeWins = 0;
    let awayWins = 0;
    if (isMultiLeg) {
      for (const leg of legs) {
        if (leg.status === 'completed' && leg.homeScore != null && leg.awayScore != null) {
          if (leg.homeScore > leg.awayScore) homeWins++;
          else if (leg.awayScore > leg.homeScore) awayWins++;
        }
      }
    }

    // Knockout: only allow scoring the first pending leg (must play in order)
    const firstPendingLeg = isMultiLeg && !isGroupStage
      ? legs.filter((l) => l.status === 'pending').sort((a, b) => (a.legNumber ?? 1) - (b.legNumber ?? 1))[0]
      : null;

    const isSeriesDone = !!seriesWinnerId || (totalLegs === 1 && firstLeg.status === 'completed');
    return (
      <View
        key={`series-${firstLeg.round}-${firstLeg.matchNumber}`}
        style={[styles.matchCard, isSeriesDone && styles.matchCardDone]}
      >
        {/* Teams header */}
        <View style={styles.matchTeams}>
          <Text style={[styles.matchTeamName, seriesWinnerId === firstLeg.homeTeamId && styles.matchWinner]} numberOfLines={1}>
            {firstLeg.homeTeamName ?? 'TBD'}
          </Text>
          {isMultiLeg
            ? <Text style={styles.seriesScore}>{homeWins}–{awayWins}</Text>
            : <Text style={styles.matchVs}>vs</Text>
          }
          <Text style={[styles.matchTeamName, seriesWinnerId === firstLeg.awayTeamId && styles.matchWinner, { textAlign: 'right' }]} numberOfLines={1}>
            {firstLeg.awayTeamName ?? 'TBD'}
          </Text>
        </View>

        {/* Multi-leg: leg-by-leg breakdown rows */}
        {isMultiLeg && legs.map((leg, idx) => {
          const isVoid = leg.status === 'void';
          const isDone = leg.status === 'completed';
          const isDeciding = decidingLeg?.id === leg.id;
          const canScore = isHost && !isDone && !isVoid &&
            (isGroupStage ? !isBye : firstPendingLeg?.id === leg.id);
          return (
            <View key={leg.id} style={[styles.legRow, isVoid && styles.legRowVoid]}>
              <Text style={styles.legLabel}>Leg {leg.legNumber ?? idx + 1}</Text>
              {isVoid ? (
                <Text style={styles.legVoidText}>Not needed</Text>
              ) : isDone ? (
                <Text style={styles.legScore}>{leg.homeScore}–{leg.awayScore}{isDeciding ? ' ✓' : ''}</Text>
              ) : (
                <Text style={styles.legPending}>Pending</Text>
              )}
              {canScore && (
                <TouchableOpacity style={styles.legScoreButton} onPress={() => setScoreModal({ match: leg })}>
                  <Text style={styles.scoreButtonText}>Score</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Single-leg: standard result */}
        {!isMultiLeg && !isBye && (
          <>
            {firstLeg.status === 'completed' ? (
              <Text style={styles.matchScore}>{firstLeg.homeScore} – {firstLeg.awayScore}</Text>
            ) : firstLeg.startISO ? (
              <Text style={styles.matchDate}>{new Date(firstLeg.startISO).toLocaleString()}</Text>
            ) : (
              <Text style={styles.matchPending}>Pending schedule</Text>
            )}
            {firstLeg.venueName && <Text style={styles.matchVenue}>📍 {firstLeg.venueName}</Text>}
            {isHost && firstLeg.status !== 'completed' && (
              <TouchableOpacity style={styles.scoreButton} onPress={() => setScoreModal({ match: firstLeg })}>
                <Text style={styles.scoreButtonText}>Enter Score</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {isBye && <Text style={styles.matchPending}>Bye</Text>}

        {/* Series winner banner */}
        {seriesWinnerId && (
          <View style={styles.seriesWinnerBanner}>
            <Text style={styles.seriesWinnerText}>
              Winner: {firstLeg.homeTeamId === seriesWinnerId ? firstLeg.homeTeamName : firstLeg.awayTeamName}
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#0a7ea4" /></View>;
  if (!tournament) return <View style={styles.center}><Text style={styles.emptyText}>Tournament not found.</Text></View>;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={2}>{tournament.name}</Text>
          <Text style={styles.headerHost}>by {tournament.hostTeamName}</Text>
        </View>
        <View style={[styles.statusBadge, getStatusStyle(tournament.status)]}>
          <Text style={styles.statusBadgeText}>{statusLabel(tournament.status)}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['info', 'teams', 'bracket'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.tabActive]} onPress={() => setActiveTab(t)}>
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'info' ? 'Info' : t === 'teams' ? `Teams (${tournament.teams.length})` : 'Bracket'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.tabContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
      >
        {activeTab === 'info' && renderInfoTab()}
        {activeTab === 'teams' && renderTeamsTab()}
        {activeTab === 'bracket' && renderBracketTab()}
      </ScrollView>

      {/* Score entry modal */}
      <ScoreModal
        visible={!!scoreModal}
        match={scoreModal?.match ?? null}
        onClose={() => setScoreModal(null)}
        onSubmit={handleSubmitResult}
      />

      {/* Multi-venue sign-up: preferred home game day/time */}
      <Modal
        visible={signUpModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSignUpModalVisible(false)}
      >
        <View style={styles.signUpModalOverlay}>
          <View style={styles.signUpModalBox}>
            <Text style={styles.signUpModalTitle}>Home Game Preferences</Text>
            <Text style={styles.signUpModalSub}>Set your preferred day and kick-off time for home games in this tournament.</Text>

            <Text style={styles.signUpModalLabel}>Preferred Day</Text>
            <View style={styles.dayRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayBtn, preferredDay === i && styles.dayBtnActive]}
                  onPress={() => setPreferredDay(i)}
                >
                  <Text style={[styles.dayBtnText, preferredDay === i && styles.dayBtnTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.signUpModalLabel}>Preferred Kick-off Time (HH:MM)</Text>
            <TextInput
              style={styles.timeInput}
              value={preferredTime}
              onChangeText={(t) => setPreferredTime(t)}
              placeholder="19:00"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />

            <View style={styles.signUpModalActions}>
              <TouchableOpacity
                style={[styles.signUpBtn, { backgroundColor: '#888' }]}
                onPress={() => setSignUpModalVisible(false)}
              >
                <Text style={styles.signUpBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.signUpBtn}
                onPress={() => confirmSignUp(preferredDay, preferredTime)}
              >
                <Text style={styles.signUpBtnText}>Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

function ScoreModal({ visible, match, onClose, onSubmit }: {
  visible: boolean;
  match: TournamentMatch | null;
  onClose: () => void;
  onSubmit: (match: TournamentMatch, home: number, away: number) => void;
}) {
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');

  useEffect(() => { if (visible) { setHomeScore('0'); setAwayScore('0'); } }, [visible]);

  if (!match) return null;

  const handleSubmit = () => {
    const h = parseInt(homeScore, 10);
    const a = parseInt(awayScore, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      Toast.show({ type: 'error', text1: 'Invalid scores' }); return;
    }
    onSubmit(match, h, a);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={scoreStyles.overlay}>
        <View style={scoreStyles.card}>
          <Text style={scoreStyles.title}>Enter Result</Text>
          <Text style={scoreStyles.matchup}>{match.homeTeamName} vs {match.awayTeamName}</Text>
          {match.legNumber != null && (
            <Text style={scoreStyles.legSubtitle}>Leg {match.legNumber} of {match.totalLegs}</Text>
          )}
          <View style={scoreStyles.scoreRow}>
            <View style={scoreStyles.scoreField}>
              <Text style={scoreStyles.scoreLabel}>{match.homeTeamName}</Text>
              <View style={scoreStyles.scoreButtons}>
                <TouchableOpacity style={scoreStyles.adj} onPress={() => setHomeScore((v) => String(Math.max(0, parseInt(v, 10) - 1)))}><Text style={scoreStyles.adjText}>−</Text></TouchableOpacity>
                <Text style={scoreStyles.scoreVal}>{homeScore}</Text>
                <TouchableOpacity style={scoreStyles.adj} onPress={() => setHomeScore((v) => String(parseInt(v, 10) + 1))}><Text style={scoreStyles.adjText}>+</Text></TouchableOpacity>
              </View>
            </View>
            <Text style={scoreStyles.vs}>–</Text>
            <View style={scoreStyles.scoreField}>
              <Text style={scoreStyles.scoreLabel}>{match.awayTeamName}</Text>
              <View style={scoreStyles.scoreButtons}>
                <TouchableOpacity style={scoreStyles.adj} onPress={() => setAwayScore((v) => String(Math.max(0, parseInt(v, 10) - 1)))}><Text style={scoreStyles.adjText}>−</Text></TouchableOpacity>
                <Text style={scoreStyles.scoreVal}>{awayScore}</Text>
                <TouchableOpacity style={scoreStyles.adj} onPress={() => setAwayScore((v) => String(parseInt(v, 10) + 1))}><Text style={scoreStyles.adjText}>+</Text></TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={scoreStyles.actions}>
            <TouchableOpacity style={scoreStyles.cancel} onPress={onClose}><Text style={scoreStyles.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={scoreStyles.submit} onPress={handleSubmit}><Text style={scoreStyles.submitText}>Save Result</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'open': return { backgroundColor: '#28a745' };
    case 'in_progress': return { backgroundColor: '#fd7e14' };
    case 'completed': return { backgroundColor: '#6c757d' };
    default: return { backgroundColor: '#dc3545' };
  }
}
function statusLabel(status: string) {
  switch (status) {
    case 'open': return 'Open';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return 'Cancelled';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 10 },
  backButton: { paddingRight: 4 },
  backButtonText: { color: '#0a7ea4', fontSize: 14, fontWeight: '600' },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  headerHost: { fontSize: 12, color: '#888', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#0a7ea4' },
  tabText: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabTextActive: { color: '#0a7ea4', fontWeight: '700' },
  tabContent: { padding: 16, paddingBottom: 40 },
  description: { fontSize: 14, color: '#444', lineHeight: 20, marginBottom: 14 },
  infoGrid: { gap: 8, marginBottom: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#111', fontWeight: '600', flex: 1, textAlign: 'right' },
  actionButton: { backgroundColor: '#0a7ea4', padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  withdrawButton: { backgroundColor: '#dc3545' },
  startButton: { backgroundColor: '#28a745' },
  eligibilityNote: { fontSize: 12, color: '#dc3545', textAlign: 'center', marginBottom: 12 },
  teamRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 10 },
  teamSeed: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e8f4fb', alignItems: 'center', justifyContent: 'center' },
  teamSeedText: { fontSize: 12, fontWeight: '700', color: '#0a7ea4' },
  teamRowName: { fontSize: 14, fontWeight: '600', color: '#111' },
  teamRowElo: { fontSize: 12, color: '#888' },
  hostBadge: { backgroundColor: '#0a7ea4', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  hostBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  emptyText: { color: '#888', textAlign: 'center', padding: 24 },
  roundSection: { marginBottom: 20 },
  roundTitle: { fontSize: 15, fontWeight: '700', color: '#0a7ea4', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', paddingBottom: 6 },
  groupLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6, marginTop: 4 },
  matchCard: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: '#fafafa' },
  matchCardDone: { backgroundColor: '#f0fff4', borderColor: '#c3e6cb' },
  matchTeams: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  matchTeamName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111' },
  matchWinner: { color: '#28a745' },
  matchVs: { fontSize: 12, color: '#888', marginHorizontal: 8 },
  matchScore: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#0a7ea4', marginVertical: 4 },
  matchDate: { textAlign: 'center', fontSize: 12, color: '#888', marginTop: 4 },
  matchPending: { textAlign: 'center', fontSize: 12, color: '#aaa', fontStyle: 'italic', marginTop: 4 },
  matchVenue: { textAlign: 'center', fontSize: 11, color: '#888', marginTop: 2 },
  scoreButton: { marginTop: 8, backgroundColor: '#0a7ea4', borderRadius: 6, paddingVertical: 6, alignItems: 'center' },
  scoreButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  legRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 8, marginTop: 2 },
  legRowVoid: { opacity: 0.35 },
  legLabel: { fontSize: 12, color: '#888', fontWeight: '600', width: 48 },
  legScore: { fontSize: 13, fontWeight: '700', color: '#0a7ea4', flex: 1 },
  legPending: { fontSize: 12, color: '#aaa', fontStyle: 'italic', flex: 1 },
  legVoidText: { fontSize: 12, color: '#aaa', fontStyle: 'italic', flex: 1 },
  legScoreButton: { backgroundColor: '#0a7ea4', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 10 },
  seriesScore: { fontSize: 14, fontWeight: '700', color: '#0a7ea4', marginHorizontal: 10 },
  seriesWinnerBanner: { marginTop: 8, backgroundColor: '#d4edda', borderRadius: 6, padding: 6, alignItems: 'center' },
  seriesWinnerText: { fontSize: 12, fontWeight: '700', color: '#155724' },
  // Sign-up preference modal
  signUpModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  signUpModalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  signUpModalTitle: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 6, textAlign: 'center' },
  signUpModalSub: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 20 },
  signUpModalLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  dayBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#f5f5f5' },
  dayBtnActive: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  dayBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  dayBtnTextActive: { color: '#fff' },
  timeInput: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 24, textAlign: 'center' },
  signUpModalActions: { flexDirection: 'row', gap: 12 },
  signUpBtn: { flex: 1, backgroundColor: '#0a7ea4', padding: 14, borderRadius: 10, alignItems: 'center' },
  signUpBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

const scoreStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 4, textAlign: 'center' },
  matchup: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 },
  legSubtitle: { fontSize: 12, color: '#0a7ea4', textAlign: 'center', fontWeight: '600', marginTop: -14, marginBottom: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 24 },
  scoreField: { alignItems: 'center', flex: 1 },
  scoreLabel: { fontSize: 12, color: '#555', fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  scoreButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  adj: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e8f4fb', alignItems: 'center', justifyContent: 'center' },
  adjText: { fontSize: 20, color: '#0a7ea4', fontWeight: '700' },
  scoreVal: { fontSize: 28, fontWeight: '700', color: '#111', minWidth: 32, textAlign: 'center' },
  vs: { fontSize: 20, color: '#888', fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12 },
  cancel: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center' },
  cancelText: { color: '#555', fontWeight: '600' },
  submit: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#0a7ea4', alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '700' },
});
