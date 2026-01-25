// app/(tabs)/GameResultsScreen.tsx
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Button,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import Toast from 'react-native-toast-message';
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig';
import { getDocument, listTopLevelCollection } from '../../src/firestoreRest';
import { calculateNewRatings, formatRatingChange, getRatingChangeDescription } from '../../src/utils/elo';
import { updateDocumentSafe } from '../../src/utils/firebase-helpers';

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
  completed?: boolean;
  homeTeamRating?: number;
  awayTeamRating?: number;
}

export default function GameResultsScreen() {
  const router = useRouter();
  const user = auth.currentUser;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamData, setTeamData] = useState<any>(null);
  
  // Modal state for entering scores
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [ratingPreview, setRatingPreview] = useState<any>(null);

  useEffect(() => {
    loadTeamAndGames();
  }, []);

  const loadTeamAndGames = async () => {
    if (!user?.uid) {
      Toast.show({ type: 'error', text1: 'Please sign in' });
      router.replace('/(auth)/LoginScreen');
      return;
    }

    setLoading(true);
    try {
      await ensureFirestoreOnline();

      // Load user's team
      const userDoc = await getDocument(`users/${user.uid}`);
      if (!userDoc?.teamId) {
        Toast.show({ type: 'info', text1: 'No team', text2: 'Join or create a team first' });
        setLoading(false);
        return;
      }

      const team = await getDocument(`teams/${userDoc.teamId}`);
      setTeamData(team);

      // Load games for this team
      const allGames = await listTopLevelCollection('games', 500);
      const teamGames = (allGames as any[]).filter((g) => 
        String(g.teamId) === String(userDoc.teamId) ||
        String(g.opponentTeamId) === String(userDoc.teamId)
      );

      // Filter to show only accepted games (games with both teams confirmed)
      const acceptedGames = teamGames.filter((g) => g.opponentTeamId && g.opponentTeamName);

      setGames(acceptedGames);
    } catch (e: any) {
      console.error('Failed to load games', e);
      Toast.show({ type: 'error', text1: 'Load failed', text2: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const openScoreModal = (game: Game) => {
    setSelectedGame(game);
    setHomeScore(game.homeScore?.toString() || '');
    setAwayScore(game.awayScore?.toString() || '');
    setModalVisible(true);
    setShowPreview(false);
    setRatingPreview(null);
  };

  const calculatePreview = () => {
    if (!selectedGame || !homeScore || !awayScore) {
      Toast.show({ type: 'info', text1: 'Enter both scores' });
      return;
    }

    const home = parseInt(homeScore);
    const away = parseInt(awayScore);

    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      Toast.show({ type: 'error', text1: 'Invalid scores' });
      return;
    }

    // Get current ratings
    const homeRating = selectedGame.homeTeamRating || teamData?.elo || 1500;
    const awayRating = selectedGame.awayTeamRating || 1500;

    const result = calculateNewRatings(homeRating, awayRating, home, away);

    setRatingPreview({
      homeOldRating: homeRating,
      awayOldRating: awayRating,
      ...result,
      homeWasUnderdog: homeRating < awayRating,
      awayWasUnderdog: awayRating < homeRating,
    });
    setShowPreview(true);
  };

  const submitScore = async () => {
    if (!selectedGame || !user?.uid) return;

    const home = parseInt(homeScore);
    const away = parseInt(awayScore);

    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      Toast.show({ type: 'error', text1: 'Invalid scores' });
      return;
    }

    Alert.alert(
      'Submit Score',
      `Confirm final score:\n${selectedGame.teamName || 'Home'}: ${home}\n${selectedGame.opponentTeamName || 'Away'}: ${away}\n\nThis will update team ratings.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setSubmitting(true);
            try {
              await ensureFirestoreOnline();

              // Get current ratings
              const homeTeam = await getDocument(`teams/${selectedGame.teamId}`);
              const awayTeam = selectedGame.opponentTeamId 
                ? await getDocument(`teams/${selectedGame.opponentTeamId}`)
                : null;

              const homeRating = homeTeam?.elo || 1500;
              const awayRating = awayTeam?.elo || 1500;

              // Calculate new ratings
              const result = calculateNewRatings(homeRating, awayRating, home, away);

              // Update game with scores
              if (!db) throw new Error('Database not initialized');
              await updateDocumentSafe(db, 'games', selectedGame.id, {
                homeScore: home,
                awayScore: away,
                completed: true,
                completedAt: new Date().toISOString(),
                homeTeamRating: homeRating,
                awayTeamRating: awayRating,
                homeNewRating: result.team1NewRating,
                awayNewRating: result.team2NewRating,
                homeRatingChange: result.team1Change,
                awayRatingChange: result.team2Change,
              });

              // Update team ratings
              await updateDocumentSafe(db, 'teams', selectedGame.teamId, {
                elo: result.team1NewRating,
              });

              if (selectedGame.opponentTeamId && awayTeam) {
                await updateDocumentSafe(db, 'teams', selectedGame.opponentTeamId, {
                  elo: result.team2NewRating,
                });
              }

              Toast.show({
                type: 'success',
                text1: 'Score submitted',
                text2: `Ratings updated: ${formatRatingChange(result.team1Change)} / ${formatRatingChange(result.team2Change)}`,
              });

              setModalVisible(false);
              loadTeamAndGames();
            } catch (e: any) {
              console.error('Failed to submit score', e);
              Toast.show({ type: 'error', text1: 'Submit failed', text2: e?.message });
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const renderGame = ({ item }: { item: Game }) => {
    const gameDate = item.startISO ? new Date(item.startISO) : null;
    const isCompleted = item.completed;

    return (
      <View style={styles.gameCard}>
        <Text style={styles.gameTitle}>{item.title || 'Game'}</Text>
        <Text style={styles.gameDate}>
          {gameDate ? gameDate.toLocaleString() : 'TBA'}
        </Text>
        <Text style={styles.teams}>
          {item.teamName || 'Home'} vs {item.opponentTeamName || 'Away'}
        </Text>

        {isCompleted ? (
          <View style={styles.scoreSection}>
            <Text style={styles.completedLabel}>✓ Completed</Text>
            <Text style={styles.finalScore}>
              Final: {item.homeScore} - {item.awayScore}
            </Text>
            {item.homeRatingChange !== undefined && (
              <Text style={styles.ratingChange}>
                Rating: {formatRatingChange(item.homeRatingChange)} / {formatRatingChange(item.awayRatingChange || 0)}
              </Text>
            )}
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            <Button
              title="Enter Score"
              onPress={() => openScoreModal(item)}
              color="#0a7ea4"
            />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 12 }}>Loading games...</Text>
      </View>
    );
  }

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

      {/* Score Entry Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Final Score</Text>
            
            <View style={styles.matchup}>
              <Text style={styles.matchupText}>
                {selectedGame?.teamName || 'Home'} vs {selectedGame?.opponentTeamName || 'Away'}
              </Text>
            </View>

            <View style={styles.scoreInputs}>
              <View style={styles.scoreInput}>
                <Text style={styles.teamLabel}>{selectedGame?.teamName || 'Home'}</Text>
                <TextInput
                  style={styles.input}
                  value={homeScore}
                  onChangeText={setHomeScore}
                  keyboardType="number-pad"
                  placeholder="0"
                />
              </View>

              <Text style={styles.vs}>-</Text>

              <View style={styles.scoreInput}>
                <Text style={styles.teamLabel}>{selectedGame?.opponentTeamName || 'Away'}</Text>
                <TextInput
                  style={styles.input}
                  value={awayScore}
                  onChangeText={setAwayScore}
                  keyboardType="number-pad"
                  placeholder="0"
                />
              </View>
            </View>

            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Button title="Preview Rating" onPress={calculatePreview} color="#FF9500" />
              </View>
            </View>

            {showPreview && ratingPreview && (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>Rating Changes Preview</Text>
                
                <View style={styles.previewTeam}>
                  <Text style={styles.previewTeamName}>{selectedGame?.teamName}</Text>
                  <Text style={styles.previewRating}>
                    {ratingPreview.homeOldRating} → {ratingPreview.team1NewRating}
                  </Text>
                  <Text style={[styles.previewChange, ratingPreview.team1Change > 0 ? styles.positive : styles.negative]}>
                    {formatRatingChange(ratingPreview.team1Change)}
                  </Text>
                  <Text style={styles.previewDesc}>
                    {getRatingChangeDescription(ratingPreview.team1Change, ratingPreview.homeWasUnderdog)}
                  </Text>
                </View>

                <View style={styles.previewTeam}>
                  <Text style={styles.previewTeamName}>{selectedGame?.opponentTeamName}</Text>
                  <Text style={styles.previewRating}>
                    {ratingPreview.awayOldRating} → {ratingPreview.team2NewRating}
                  </Text>
                  <Text style={[styles.previewChange, ratingPreview.team2Change > 0 ? styles.positive : styles.negative]}>
                    {formatRatingChange(ratingPreview.team2Change)}
                  </Text>
                  <Text style={styles.previewDesc}>
                    {getRatingChangeDescription(ratingPreview.team2Change, ratingPreview.awayWasUnderdog)}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Button
                  title="Cancel"
                  onPress={() => setModalVisible(false)}
                  color="#666"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={submitting ? 'Submitting...' : 'Submit Score'}
                  onPress={submitScore}
                  disabled={submitting || !homeScore || !awayScore}
                  color="#4CAF50"
                />
              </View>
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
  header: { padding: 20, backgroundColor: '#f5f5f5', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0a7ea4' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  gameCard: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  gameTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  gameDate: { fontSize: 14, color: '#666', marginBottom: 8 },
  teams: { fontSize: 16, color: '#333', marginBottom: 8 },
  scoreSection: { marginTop: 8, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 },
  completedLabel: { fontSize: 14, color: '#4CAF50', fontWeight: '600', marginBottom: 4 },
  finalScore: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  ratingChange: { fontSize: 14, color: '#666', marginTop: 4 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#999', fontWeight: '600' },
  emptySubtext: { fontSize: 14, color: '#ccc', marginTop: 8, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 16, color: '#0a7ea4' },
  matchup: { padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6, marginBottom: 20 },
  matchupText: { fontSize: 16, textAlign: 'center', fontWeight: '600' },
  scoreInputs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  scoreInput: { flex: 1, alignItems: 'center' },
  teamLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: {
    borderWidth: 2,
    borderColor: '#0a7ea4',
    borderRadius: 8,
    padding: 16,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    width: '100%',
  },
  vs: { fontSize: 24, fontWeight: 'bold', marginHorizontal: 16, color: '#666' },
  buttonRow: { flexDirection: 'row', marginTop: 12 },
  preview: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 16,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  previewTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#333' },
  previewTeam: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  previewTeamName: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  previewRating: { fontSize: 14, color: '#666', marginBottom: 4 },
  previewChange: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  positive: { color: '#4CAF50' },
  negative: { color: '#F44336' },
  previewDesc: { fontSize: 13, color: '#666', fontStyle: 'italic' },
});
