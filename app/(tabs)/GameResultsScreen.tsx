// app/(tabs)/GameResultsScreen.tsx
import { useAuth } from '@/context/AuthContext';
import { calculateNewRatings, formatRatingChange, getRatingChangeDescription } from '@/src/utils/elo';
import firestore from '@react-native-firebase/firestore';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import Toast from 'react-native-toast-message';

interface Game {
  id: string;
  title?: string;
  startISO?: string;
  teamId?: string;
  teamName?: string;
  opponentTeamId?: string;
  opponentTeamName?: string;
  homeScore?: number;
  awayScore?: number;
  homeRatingChange?: number;
  awayRatingChange?: number;
  completed?: boolean;
  homeTeamRating?: number;
  awayTeamRating?: number;
}

interface RatingPreview {
  homeOldRating: number;
  awayOldRating: number;
  team1NewRating: number;
  team2NewRating: number;
  team1Change: number;
  team2Change: number;
  homeWasUnderdog: boolean;
  awayWasUnderdog: boolean;
}

export default function GameResultsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamData, setTeamData] = useState<Record<string, unknown> | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [ratingPreview, setRatingPreview] = useState<RatingPreview | null>(null);

  const loadTeamAndGames = useCallback(async () => {
    if (!user?.uid) {
      Toast.show({ type: 'error', text1: 'Please sign in' });
      router.replace('/(auth)/LoginScreen');
      return;
    }
    setLoading(true);
    try {
      const userSnap = await firestore().collection('users').doc(user.uid).get();
      const teamId = userSnap.data()?.teamId as string | undefined;
      if (!teamId) {
        Toast.show({ type: 'info', text1: 'No team', text2: 'Join or create a team first' });
        return;
      }

      const teamSnap = await firestore().collection('teams').doc(teamId).get();
      setTeamData(teamSnap.data() != null ? { id: teamSnap.id, ...teamSnap.data() } : null);

      const [homeSnap, awaySnap] = await Promise.all([
        firestore().collection('games').where('teamId', '==', teamId).get(),
        firestore().collection('games').where('opponentTeamId', '==', teamId).get(),
      ]);

      const all = new Map<string, Game>();
      [...homeSnap.docs, ...awaySnap.docs].forEach((d) => {
        const g = { id: d.id, ...d.data() } as Game;
        if (g.opponentTeamId && g.opponentTeamName) all.set(d.id, g);
      });

      setGames([...all.values()]);
    } catch (e: unknown) {
      console.error('[GameResults] loadTeamAndGames failed', e);
      Toast.show({ type: 'error', text1: 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [user?.uid, router]);

  useEffect(() => { loadTeamAndGames(); }, [loadTeamAndGames]);

  const openScoreModal = (game: Game) => {
    setSelectedGame(game);
    setHomeScore(game.homeScore?.toString() ?? '');
    setAwayScore(game.awayScore?.toString() ?? '');
    setModalVisible(true);
    setShowPreview(false);
    setRatingPreview(null);
  };

  const calculatePreview = () => {
    if (!selectedGame || !homeScore || !awayScore) { Toast.show({ type: 'info', text1: 'Enter both scores' }); return; }
    const home = parseInt(homeScore);
    const away = parseInt(awayScore);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { Toast.show({ type: 'error', text1: 'Invalid scores' }); return; }
    const homeRating = selectedGame.homeTeamRating ?? (teamData?.elo as number) ?? 1500;
    const awayRating = selectedGame.awayTeamRating ?? 1500;
    const result = calculateNewRatings(homeRating, awayRating, home, away);
    setRatingPreview({ homeOldRating: homeRating, awayOldRating: awayRating, ...result, homeWasUnderdog: homeRating < awayRating, awayWasUnderdog: awayRating < homeRating });
    setShowPreview(true);
  };

  const submitScore = async () => {
    if (!selectedGame || !user?.uid) return;
    const home = parseInt(homeScore);
    const away = parseInt(awayScore);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) { Toast.show({ type: 'error', text1: 'Invalid scores' }); return; }

    Alert.alert('Submit Score', `Confirm: ${selectedGame.teamName ?? 'Home'} ${home} – ${away} ${selectedGame.opponentTeamName ?? 'Away'}\n\nThis will update team ratings.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit', onPress: async () => {
          setSubmitting(true);
          try {
            const [homeTeamSnap, awayTeamSnap] = await Promise.all([
              selectedGame.teamId ? firestore().collection('teams').doc(selectedGame.teamId).get() : Promise.resolve(null),
              selectedGame.opponentTeamId ? firestore().collection('teams').doc(selectedGame.opponentTeamId).get() : Promise.resolve(null),
            ]);
            const homeRating = (homeTeamSnap?.data()?.elo as number) ?? 1500;
            const awayRating = (awayTeamSnap?.data()?.elo as number) ?? 1500;
            const result = calculateNewRatings(homeRating, awayRating, home, away);

            const batch = firestore().batch();
            batch.update(firestore().collection('games').doc(selectedGame.id), {
              homeScore: home, awayScore: away, completed: true,
              completedAt: firestore.FieldValue.serverTimestamp(),
              homeTeamRating: homeRating, awayTeamRating: awayRating,
              homeNewRating: result.team1NewRating, awayNewRating: result.team2NewRating,
              homeRatingChange: result.team1Change, awayRatingChange: result.team2Change,
            });
            if (selectedGame.teamId) batch.update(firestore().collection('teams').doc(selectedGame.teamId), { elo: result.team1NewRating });
            if (selectedGame.opponentTeamId && awayTeamSnap?.exists) batch.update(firestore().collection('teams').doc(selectedGame.opponentTeamId), { elo: result.team2NewRating });
            await batch.commit();

            Toast.show({ type: 'success', text1: 'Score submitted', text2: `${formatRatingChange(result.team1Change)} / ${formatRatingChange(result.team2Change)}` });
            setModalVisible(false);
            loadTeamAndGames();
          } catch (e: unknown) {
            console.error('[GameResults] submitScore failed', e);
            Toast.show({ type: 'error', text1: 'Submit failed' });
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  };

  const renderGame = ({ item }: { item: Game }) => {
    const gameDate = item.startISO ? new Date(item.startISO) : null;
    return (
      <View style={styles.gameCard}>
        <Text style={styles.gameTitle}>{item.title || 'Game'}</Text>
        <Text style={styles.gameDate}>{gameDate ? gameDate.toLocaleString() : 'TBA'}</Text>
        <Text style={styles.teams}>{item.teamName || 'Home'} vs {item.opponentTeamName || 'Away'}</Text>
        {item.completed ? (
          <View style={styles.scoreSection}>
            <Text style={styles.completedLabel}>✓ Completed</Text>
            <Text style={styles.finalScore}>Final: {item.homeScore} - {item.awayScore}</Text>
            {item.homeRatingChange != null && (
              <Text style={styles.ratingChange}>Rating: {formatRatingChange(item.homeRatingChange)} / {formatRatingChange(item.awayRatingChange ?? 0)}</Text>
            )}
          </View>
        ) : (
          <TouchableOpacity style={styles.enterScoreButton} onPress={() => openScoreModal(item)}>
            <Text style={styles.enterScoreText}>Enter Score</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /><Text style={styles.loadingText}>Loading games...</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Game Results</Text>
        <Text style={styles.subtitle}>Enter scores and update ratings</Text>
      </View>

      <FlatList
        data={games}
        keyExtractor={(item) => item.id}
        renderItem={renderGame}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No accepted games yet</Text>
            <Text style={styles.emptySubtext}>Games will appear here after accepting game requests</Text>
          </View>
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Final Score</Text>
            <View style={styles.matchup}>
              <Text style={styles.matchupText}>{selectedGame?.teamName || 'Home'} vs {selectedGame?.opponentTeamName || 'Away'}</Text>
            </View>
            <View style={styles.scoreInputs}>
              <View style={styles.scoreInput}>
                <Text style={styles.teamLabel}>{selectedGame?.teamName || 'Home'}</Text>
                <TextInput style={styles.input} value={homeScore} onChangeText={setHomeScore} keyboardType="number-pad" placeholder="0" />
              </View>
              <Text style={styles.vsSeparator}>-</Text>
              <View style={styles.scoreInput}>
                <Text style={styles.teamLabel}>{selectedGame?.opponentTeamName || 'Away'}</Text>
                <TextInput style={styles.input} value={awayScore} onChangeText={setAwayScore} keyboardType="number-pad" placeholder="0" />
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.modalButton, styles.previewButton]} onPress={calculatePreview}>
                <Text style={styles.modalButtonText}>Preview Rating</Text>
              </TouchableOpacity>
            </View>

            {showPreview && ratingPreview && (
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>Rating Changes Preview</Text>
                {([
                  { name: selectedGame?.teamName, old: ratingPreview.homeOldRating, newR: ratingPreview.team1NewRating, change: ratingPreview.team1Change, underdog: ratingPreview.homeWasUnderdog },
                  { name: selectedGame?.opponentTeamName, old: ratingPreview.awayOldRating, newR: ratingPreview.team2NewRating, change: ratingPreview.team2Change, underdog: ratingPreview.awayWasUnderdog },
                ]).map((t) => (
                  <View key={t.name} style={styles.previewTeam}>
                    <Text style={styles.previewTeamName}>{t.name}</Text>
                    <Text style={styles.previewRating}>{t.old} → {t.newR}</Text>
                    <Text style={[styles.previewChange, t.change > 0 ? styles.positive : styles.negative]}>{formatRatingChange(t.change)}</Text>
                    <Text style={styles.previewDesc}>{getRatingChangeDescription(t.change, t.underdog)}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton, (!homeScore || !awayScore || submitting) && styles.buttonDisabled]}
                onPress={submitScore}
                disabled={submitting || !homeScore || !awayScore}
              >
                <Text style={styles.modalButtonText}>{submitting ? 'Submitting...' : 'Submit Score'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#444' },
  header: { padding: 20, backgroundColor: '#f5f5f5', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0a7ea4' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  gameCard: { backgroundColor: '#fff', padding: 16, marginHorizontal: 16, marginVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
  gameTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  gameDate: { fontSize: 14, color: '#666', marginBottom: 8 },
  teams: { fontSize: 16, color: '#333', marginBottom: 8 },
  scoreSection: { marginTop: 8, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 },
  completedLabel: { fontSize: 14, color: '#4CAF50', fontWeight: '600', marginBottom: 4 },
  finalScore: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  ratingChange: { fontSize: 14, color: '#666', marginTop: 4 },
  enterScoreButton: { marginTop: 8, backgroundColor: '#0a7ea4', padding: 10, borderRadius: 6, alignItems: 'center' },
  enterScoreText: { color: '#fff', fontWeight: '600' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#999', fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: '#ccc', marginTop: 8, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 16, color: '#0a7ea4' },
  matchup: { padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6, marginBottom: 20 },
  matchupText: { fontSize: 16, textAlign: 'center', fontWeight: '600' },
  scoreInputs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  scoreInput: { flex: 1, alignItems: 'center' },
  teamLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: { borderWidth: 2, borderColor: '#0a7ea4', borderRadius: 8, padding: 16, fontSize: 24, fontWeight: 'bold', textAlign: 'center', width: '100%' },
  vsSeparator: { fontSize: 24, fontWeight: 'bold', marginHorizontal: 16, color: '#666' },
  buttonRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  modalButton: { flex: 1, padding: 12, borderRadius: 6, alignItems: 'center' },
  previewButton: { backgroundColor: '#FF9500' },
  submitButton: { backgroundColor: '#4CAF50' },
  cancelButton: { backgroundColor: '#f0f0f0' },
  cancelButtonText: { color: '#333', fontWeight: '600' },
  modalButtonText: { color: '#fff', fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
  previewBox: { backgroundColor: '#f9f9f9', borderRadius: 8, padding: 16, marginVertical: 16, borderWidth: 1, borderColor: '#ddd' },
  previewTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#333' },
  previewTeam: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  previewTeamName: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  previewRating: { fontSize: 14, color: '#666', marginBottom: 4 },
  previewChange: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  positive: { color: '#4CAF50' },
  negative: { color: '#F44336' },
  previewDesc: { fontSize: 13, color: '#666', fontStyle: 'italic' },
});
