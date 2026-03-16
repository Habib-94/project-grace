import { useAuth } from '@/context/AuthContext';
import TutorialModal from '@/src/components/TutorialModal';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, where } from '@react-native-firebase/firestore';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

type Game = {
  id: string;
  title?: string;
  startISO?: string;
  location?: { lat?: number; lng?: number; label?: string };
  kitColor?: string | null;
  teamId?: string;
  teamName?: string;
  teamLocation?: string;
  type?: string;
  elo?: number;
  createdBy?: string;
  teamRating?: number | null;
  teamHomeColor?: string | null;
  awayColor?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
  createdByRating?: number | null;
};

const db = getFirestore();

export default function GameSchedulerScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [recurrence, setRecurrence] = useState<'none' | 'weekly' | 'monthly'>('none');
  const [previewCount] = useState<number>(6);
  const [creating, setCreating] = useState(false);
  const [createdGames, setCreatedGames] = useState<Game[]>([]);
  const [fetchingCreatedGames, setFetchingCreatedGames] = useState(false);
  const [tutorialVisible, setTutorialVisible] = useState(true);
  const [gameTitleText, setGameTitleText] = useState('');
  const [selectedOccurrences, setSelectedOccurrences] = useState<Record<string, boolean>>({});
  const [creationStatus, setCreationStatus] = useState<Record<string, 'idle' | 'pending' | 'success' | 'error'>>({});
  const [totalToCreate, setTotalToCreate] = useState(0);
  const [createdCount, setCreatedCount] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [requesting, setRequesting] = useState(false);

  const composedDate = useMemo(() => {
    const d = new Date(date);
    const t = new Date(time);
    d.setHours(t.getHours(), t.getMinutes(), 0, 0);
    return d;
  }, [date, time]);

  const previewOccurrences: Date[] = useMemo(() => {
    const occurrences: Date[] = [];
    const start = new Date(composedDate);
    for (let i = 0; i < previewCount; i++) {
      if (recurrence === 'none') { occurrences.push(new Date(start)); break; }
      const copy = new Date(start);
      if (recurrence === 'weekly') copy.setDate(copy.getDate() + 7 * i);
      else copy.setMonth(copy.getMonth() + i);
      occurrences.push(copy);
    }
    return occurrences;
  }, [composedDate, previewCount, recurrence]);

  useEffect(() => {
    const init: Record<string, boolean> = {};
    previewOccurrences.forEach((d) => (init[d.toISOString()] = true));
    setSelectedOccurrences(init);
    setCreationStatus({});
    setTotalToCreate(0);
    setCreatedCount(0);
  }, [previewOccurrences]);

  useEffect(() => { if (user?.uid) fetchCreatedGames(); }, [user?.uid]);

  // Optional calendar lib
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CalendarList: React.ComponentType<any> | null = null;
  try { CalendarList = require('react-native-calendars').CalendarList; } catch {}

  const markedDates = useMemo(() => {
    const obj: Record<string, unknown> = {};
    previewOccurrences.forEach((d) => {
      const iso = d.toISOString();
      const key = iso.slice(0, 10);
      const isSelected = !!selectedOccurrences[iso];
      const status = creationStatus[iso] ?? 'idle';
      const alreadyCreated = createdGames.some((g) => g.startISO === iso);
      let dotColor = '#2E86AB';
      let selected = false;
      let selectedColor: string | undefined;
      if (alreadyCreated) { dotColor = '#FF3B30'; selected = true; selectedColor = '#fff1f0'; }
      else if (status === 'pending') { dotColor = '#f0ad4e'; selected = true; selectedColor = '#fff8e6'; }
      else if (status === 'success') { dotColor = '#28a745'; selected = true; selectedColor = '#ecffef'; }
      else if (status === 'error') { dotColor = '#b00020'; selected = true; selectedColor = '#fff1f0'; }
      else if (isSelected) { dotColor = '#054f73'; selected = true; selectedColor = '#d7eef6'; }
      if (!obj[key]) obj[key] = { marked: true, dotColor, selected, selectedColor };
    });
    createdGames.forEach((g) => {
      if (!g.startISO) return;
      const key = new Date(g.startISO).toISOString().slice(0, 10);
      if (!obj[key]) obj[key] = { marked: true, dotColor: '#FF3B30', selected: true, selectedColor: '#fff1f0' };
    });
    return obj;
  }, [previewOccurrences, selectedOccurrences, creationStatus, createdGames]);

  async function fetchCreatedGames() {
    if (!user?.uid) { setCreatedGames([]); return; }
    setFetchingCreatedGames(true);
    try {
      const snap = await getDocs(query(collection(db, 'games'), where('createdBy', '==', user.uid)));
      const items: Game[] = (snap.docs as Array<{ id: string; data(): Record<string, unknown> }>)
        .map((d) => ({ id: d.id, ...d.data() } as Game))
        .sort((a: Game, b: Game) => {
          if (!a.startISO && !b.startISO) return 0;
          if (!a.startISO) return 1;
          if (!b.startISO) return -1;
          return a.startISO.localeCompare(b.startISO);
        });
      setCreatedGames(items);
    } catch (e) {
      console.warn('[GameScheduler] fetchCreatedGames failed', e);
      setCreatedGames([]);
    } finally {
      setFetchingCreatedGames(false);
    }
  }

  async function deleteCreatedGame(id: string) {
    Alert.alert('Delete Game', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteDoc(doc(db, 'games', id));
            setCreatedGames((prev) => prev.filter((g) => g.id !== id));
            Toast.show({ type: 'info', text1: 'Game removed' });
          } catch (e: unknown) {
            console.error('[GameScheduler] deleteGame failed', e);
            Toast.show({ type: 'error', text1: 'Delete failed' });
          }
        },
      },
    ], { cancelable: true });
  }

  async function createGames() {
    if (!user?.uid) { Toast.show({ type: 'error', text1: 'Sign in required' }); return; }

    const selectedIsos = previewOccurrences.map((d) => d.toISOString()).filter((iso) => selectedOccurrences[iso]);
    if (!selectedIsos.length) { Toast.show({ type: 'info', text1: 'No occurrences selected' }); return; }

    setCreating(true);
    try {
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      if (!userSnap.exists) { Toast.show({ type: 'error', text1: 'User record missing' }); return; }
      const userDoc = userSnap.data()!;
      const teamId = userDoc.teamId as string;
      if (!userDoc.isCoordinator || !teamId) {
        Toast.show({ type: 'error', text1: 'Permission denied', text2: 'You must be a coordinator with a team.' });
        return;
      }

      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      const teamDoc = teamSnap.data() ?? {};
      const teamName = (teamDoc.teamName as string) ?? '';
      const teamLat = (teamDoc.latitude ?? teamDoc.lat ?? null) as number | null;
      const teamLng = (teamDoc.longitude ?? teamDoc.lng ?? null) as number | null;
      const teamLabel = (teamDoc.location as string) ?? '';
      const teamPlaceId = (teamDoc.placeId as string) ?? '';

      const newStatus: Record<string, 'pending'> = {};
      selectedIsos.forEach((iso) => (newStatus[iso] = 'pending'));
      setCreationStatus((prev) => ({ ...prev, ...newStatus }));
      setTotalToCreate(selectedIsos.length);
      setCreatedCount(0);

      const defaultTitle = gameTitleText.trim() || 'Available Game';
      let successCount = 0;

      for (const iso of selectedIsos) {
        try {
          const payload = {
            teamId,
            teamName,
            teamRating: (teamDoc.elo ?? teamDoc.rating ?? null) as number | null,
            title: defaultTitle,
            type: 'open',
            startISO: iso,
            location: teamLat != null && teamLng != null ? { lat: teamLat, lng: teamLng, label: teamLabel } : null,
            placeId: teamPlaceId || null,
            kitColor: null,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            createdByName: (userDoc.name ?? user.displayName ?? '') as string,
            createdByEmail: (userDoc.email ?? user.email ?? '') as string,
            createdByRating: (userDoc.rating ?? null) as number | null,
            coordinatorName: (userDoc.name ?? user.displayName ?? '') as string,
            teamHomeColor: (teamDoc.homeColor ?? null) as string | null,
            expiresAt: new Date(iso),
          };

          const ref = await addDoc(collection(db, 'games'), payload);
          const createdItem: Game = {
            id: ref.id,
            title: payload.title,
            startISO: iso,
            ...(payload.location != null ? { location: payload.location } : {}),
            kitColor: null,
            teamId,
            teamName,
            type: payload.type,
            createdBy: user.uid,
            createdByName: payload.createdByName,
            teamRating: payload.teamRating,
            teamHomeColor: payload.teamHomeColor,
          };
          setCreatedGames((prev) => [createdItem, ...prev]);
          setCreationStatus((prev) => ({ ...prev, [iso]: 'success' }));
          successCount++;
          setCreatedCount((c) => c + 1);
        } catch (itemErr: unknown) {
          console.warn('[GameScheduler] failed to create occurrence', iso, itemErr);
          setCreationStatus((prev) => ({ ...prev, [iso]: 'error' }));
        }
      }

      Toast.show(successCount > 0
        ? { type: 'success', text1: 'Games created', text2: `${successCount} game(s) created.` }
        : { type: 'error', text1: 'Create failed', text2: 'None of the selected occurrences could be created.' }
      );

      await fetchCreatedGames();
    } catch (e: unknown) {
      console.error('[GameScheduler] createGames error', e);
      Toast.show({ type: 'error', text1: 'Create failed' });
    } finally {
      setCreating(false);
    }
  }

  async function requestGame() {
    if (!selectedGame?.id || !user?.uid) return;
    if (selectedGame.createdBy === user.uid) {
      Toast.show({ type: 'info', text1: "Can't request your own game" });
      setModalVisible(false);
      return;
    }
    setRequesting(true);
    try {
      // TODO: implement game request logic
      Toast.show({ type: 'success', text1: 'Request sent' });
      setModalVisible(false);
    } catch (e: unknown) {
      console.error('[GameScheduler] requestGame error', e);
      Toast.show({ type: 'error', text1: 'Request failed' });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Schedule a Game</Text>

        <View style={styles.row}>
          <Pressable onPress={() => setShowDatePicker(true)} style={styles.pickerButton}>
            <Text style={styles.pickerText}>Date: {date.toDateString()}</Text>
          </Pressable>
          <Pressable onPress={() => setShowTimePicker(true)} style={styles.pickerButton}>
            <Text style={styles.pickerText}>Time: {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </Pressable>
        </View>

        {showDatePicker && <DateTimePicker value={date} mode="date" display="default" onChange={(_, s) => { setShowDatePicker(false); if (s) setDate(s); }} />}
        {showTimePicker && <DateTimePicker value={time} mode="time" is24Hour={false} display="default" onChange={(_, s) => { setShowTimePicker(false); if (s) setTime(s); }} />}

        <View style={styles.row}>
          {(['none', 'weekly', 'monthly'] as const).map((r) => (
            <Pressable key={r} style={[styles.optionButton, recurrence === r && styles.optionActive]} onPress={() => setRecurrence(r)}>
              <Text>{r === 'none' ? 'Single' : r.charAt(0).toUpperCase() + r.slice(1)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.titleInputSection}>
          <Text style={styles.titleInputLabel}>Optional title for created games</Text>
          <TextInput
            value={gameTitleText}
            onChangeText={setGameTitleText}
            placeholder="e.g. Open Match / Practice"
            style={styles.smallInput}
            returnKeyType="done"
          />
          <Text style={styles.helperText}>Leave empty to use "Available Game".</Text>
        </View>

        <View style={styles.preview}>
          <Text style={styles.subHeader}>Preview ({previewOccurrences.length})</Text>
          {CalendarList && (
            <CalendarList
              horizontal
              pastScrollRange={0}
              futureScrollRange={6}
              markedDates={markedDates}
              markingType="multi-dot"
              style={styles.calendar}
            />
          )}
          <View style={styles.selectAllRow}>
            <Text style={styles.occurrenceCount}>{previewOccurrences.length} occurrence(s)</Text>
            <Pressable onPress={() => {
              const allSelected = previewOccurrences.every((d) => selectedOccurrences[d.toISOString()]);
              const next: Record<string, boolean> = {};
              previewOccurrences.forEach((d) => (next[d.toISOString()] = !allSelected));
              setSelectedOccurrences(next);
            }}>
              <Text style={styles.selectAllText}>
                {previewOccurrences.every((d) => selectedOccurrences[d.toISOString()]) ? 'Deselect all' : 'Select all'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.previewWrap}>
            {previewOccurrences.map((d) => {
              const iso = d.toISOString();
              const isSelected = !!selectedOccurrences[iso];
              const status = creationStatus[iso] ?? 'idle';
              const alreadyCreated = createdGames.some((g) => g.startISO === iso);
              let bg = '#f4f4f4';
              if (alreadyCreated) bg = '#fff1f0';
              else if (status === 'pending') bg = '#fff8e6';
              else if (status === 'success') bg = '#ecffef';
              else if (status === 'error') bg = '#fff1f0';
              else if (isSelected) bg = '#d7eef6';
              return (
                <Pressable key={iso} onPress={() => setSelectedOccurrences((prev) => ({ ...prev, [iso]: !prev[iso] }))} style={[styles.previewRow, { backgroundColor: bg }]}>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={styles.previewRowContent}>
                    <Text style={styles.previewDateText}>{d.toDateString()}</Text>
                    <Text style={styles.previewTimeText}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <View>
                    {status === 'pending' && <ActivityIndicator size="small" />}
                    {status === 'success' && <Text style={styles.statusSuccess}>Created</Text>}
                    {status === 'error' && <Text style={styles.statusError}>Failed</Text>}
                    {status === 'idle' && alreadyCreated && <Text style={styles.statusError}>Already created</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={createGames}
            disabled={creating}
            style={[styles.createButton, creating && styles.createButtonDisabled]}
          >
            {creating ? (
              <View style={styles.createButtonInner}>
                <ActivityIndicator color="white" style={styles.createButtonSpinner} />
                <Text style={styles.createButtonText}>Creating {createdCount}/{totalToCreate || previewOccurrences.length}</Text>
              </View>
            ) : (
              <Text style={styles.createButtonText}>Create {Object.values(selectedOccurrences).filter(Boolean).length} occurrence(s)</Text>
            )}
          </TouchableOpacity>

          {creating && totalToCreate > 0 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.round((createdCount / totalToCreate) * 100)}%` }]} />
            </View>
          )}

          <TouchableOpacity style={styles.findGamesButton} onPress={() => router.push('/(tabs)/FindGamesScreen')}>
            <Text style={styles.findGamesButtonText}>Find Games</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.createdGamesSection}>
          <Text style={styles.createdGamesTitle}>Your created games</Text>
          {fetchingCreatedGames ? <ActivityIndicator /> : createdGames.length === 0 ? (
            <Text style={styles.noGamesText}>No games created by you</Text>
          ) : (
            createdGames.map((item) => {
              const dt = item.startISO ? new Date(item.startISO) : null;
              return (
                <View key={item.id} style={styles.gameCard}>
                  <TouchableOpacity style={styles.deleteButton} onPress={() => deleteCreatedGame(item.id)}>
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                  <View style={[styles.colorPill, { backgroundColor: item.kitColor ?? '#ccc' }]} />
                  <Text style={styles.gameTitle}>{item.title ?? 'Game'}</Text>
                  <Text style={styles.gameMeta}>{dt ? dt.toLocaleString() : 'TBA'} • {(item.type ?? '').toUpperCase() || 'N/A'}</Text>
                  <Text style={styles.gameMeta}>Team: {item.teamName ?? item.teamId ?? '—'}</Text>
                  <Text style={styles.gameMeta}>Location: {item.teamLocation ?? item.location?.label ?? '—'}</Text>
                  <TouchableOpacity onPress={() => { setSelectedGame(item); setModalVisible(true); }} style={styles.viewDetailsButton}>
                    <Text style={styles.viewDetailsText}>View Details</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <TutorialModal
        visible={tutorialVisible}
        onClose={() => setTutorialVisible(false)}
        title="Schedule games quickly"
        body="Pick a date/time, optionally choose recurrence, select occurrences and tap Create. Already-created games are shown in red."
        imageSource={require('@/assets/images/mascot.png')}
      />

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedGame?.title ?? selectedGame?.teamName ?? 'Game details'}</Text>
            <Text style={styles.modalDetail}>When: {selectedGame?.startISO ? new Date(selectedGame.startISO).toLocaleString() : 'TBA'}</Text>
            <Text style={styles.modalDetail}>Where: {selectedGame?.teamLocation ?? selectedGame?.location?.label ?? 'Unknown'}</Text>
            <Text style={styles.modalDetail}>Team: {selectedGame?.teamName ?? 'Unknown'}</Text>
            <View style={styles.kitRow}>
              <View style={[styles.kitSwatch, { backgroundColor: selectedGame?.teamHomeColor ?? selectedGame?.kitColor ?? '#fff' }]} />
              <Text style={styles.modalDetail}>Home kit</Text>
              <View style={styles.kitSwatchGap} />
              <View style={[styles.kitSwatch, { backgroundColor: selectedGame?.awayColor ?? '#fff' }]} />
              <Text style={styles.modalDetail}>Away kit</Text>
            </View>
            <Text style={styles.modalDetail}>Team Rating: {selectedGame?.teamRating ?? selectedGame?.elo ?? '—'}</Text>
            <Text style={styles.modalDetailLast}>Coordinator: {selectedGame?.createdByName ?? user?.displayName ?? 'You'}</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => { setModalVisible(false); setSelectedGame(null); }} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
              <Pressable
                onPress={requestGame}
                disabled={requesting || selectedGame?.createdBy === user?.uid}
                style={styles.modalRequestButton}
              >
                <Text style={styles.modalRequestText}>
                  {requesting ? 'Sending...' : selectedGame?.createdBy === user?.uid ? 'You created this' : 'Request Game'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 16 },
  header: { fontSize: 20, fontWeight: '700', marginBottom: 8, paddingTop: 8 },
  subHeader: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  pickerButton: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  pickerText: { fontSize: 14 },
  optionButton: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  optionActive: { backgroundColor: '#e6f4fe', borderColor: '#2e86ab' },
  titleInputSection: { marginTop: 8 },
  titleInputLabel: { marginBottom: 6, fontSize: 14, fontWeight: '600' },
  smallInput: { minWidth: 84, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff' },
  helperText: { color: '#666', fontSize: 12, marginTop: 6 },
  preview: { marginTop: 8 },
  calendar: { borderRadius: 8, marginVertical: 8 },
  selectAllRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  occurrenceCount: { fontSize: 13 },
  selectAllText: { color: '#054f73', fontWeight: '600' },
  previewWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 6, marginRight: 8, marginBottom: 8, minWidth: 200 },
  previewRowContent: { flex: 1 },
  previewDateText: { fontWeight: '600' },
  previewTimeText: { color: '#666', fontSize: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 3, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fff', marginRight: 8, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: '#054f73', backgroundColor: '#054f73' },
  checkmark: { color: 'white', fontSize: 12 },
  statusSuccess: { color: 'green', fontWeight: '600' },
  statusError: { color: '#b00020', fontWeight: '600' },
  createButton: { backgroundColor: '#0a7ea4', padding: 10, borderRadius: 6, alignItems: 'center', marginTop: 10 },
  createButtonDisabled: { backgroundColor: '#999' },
  createButtonInner: { flexDirection: 'row', alignItems: 'center' },
  createButtonSpinner: { marginRight: 8 },
  createButtonText: { color: 'white' },
  progressBar: { marginTop: 8, height: 6, width: '100%', backgroundColor: '#eee', borderRadius: 4 },
  progressFill: { height: '100%', backgroundColor: '#2E86AB', borderRadius: 4 },
  findGamesButton: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1, borderColor: '#0a7ea4', alignSelf: 'center' },
  findGamesButtonText: { color: '#0a7ea4', fontWeight: '600' },
  createdGamesSection: { padding: 16 },
  createdGamesTitle: { fontWeight: '700', marginBottom: 8 },
  noGamesText: { color: '#666' },
  gameCard: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: '#fff' },
  deleteButton: { position: 'absolute', right: 10, top: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#FF3B30', borderRadius: 6 },
  deleteButtonText: { color: 'white', fontWeight: '600' },
  colorPill: { width: 28, height: 6, borderRadius: 4, marginBottom: 8 },
  gameTitle: { fontSize: 14, fontWeight: '600' },
  gameMeta: { fontSize: 12, color: '#555' },
  viewDetailsButton: { marginTop: 8, paddingVertical: 10, borderRadius: 6, backgroundColor: '#0a7ea4', alignItems: 'center' },
  viewDetailsText: { color: 'white', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalContent: { backgroundColor: '#fff', borderRadius: 8, padding: 16, maxHeight: '90%' },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalDetail: { color: '#333', marginBottom: 4 },
  modalDetailLast: { color: '#333', marginTop: 8, marginBottom: 12 },
  kitRow: { flexDirection: 'row', marginTop: 8, alignItems: 'center' },
  kitSwatch: { width: 16, height: 16, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  kitSwatchGap: { width: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  modalCloseButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#eee' },
  modalCloseText: { color: '#333' },
  modalRequestButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#0a7ea4' },
  modalRequestText: { color: '#fff' },
});