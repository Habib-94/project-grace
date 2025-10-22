import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';

import Toast from 'react-native-toast-message';
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig'; // db/auth/ensure helper
import { debugAuthState, getDocument, runCollectionQuery } from '../../src/firestoreRest';

// Minimal types for this screen
type Game = {
  id: string;
  title?: string;
  startISO?: string;
  location?: { lat?: number; lng?: number; label?: string };
  kitColor?: string | null;
  teamId?: string;
  elo?: number;
  createdBy?: string;
};

export default function GameSchedulerScreen() {
  const router = useRouter();

  // date/time (for creating availabilities)
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // recurrence / preview
  const [recurrence, setRecurrence] = useState<'none' | 'weekly' | 'monthly'>('none');
  const [previewCount, setPreviewCount] = useState<number>(6);

  // creation state
  const [creating, setCreating] = useState(false);

  // created games (games this coordinator created via this screen)
  const [createdGames, setCreatedGames] = useState<Game[]>([]);
  const [fetchingCreatedGames, setFetchingCreatedGames] = useState(false);

  // optional title for created games
  const [gameTitleText, setGameTitleText] = useState<string>('');

  // preview occurrences
  const composedDate = useMemo(() => {
    const d = new Date(date);
    const t = new Date(time);
    d.setHours(t.getHours(), t.getMinutes(), 0, 0);
    return d;
  }, [date, time]);

  const previewOccurrences: Date[] = useMemo(() => {
    const occurrences: Date[] = [];
    const start = new Date(composedDate);
    for (let i = 0; i < previewCount; i += 1) {
      const copy = new Date(start);
      if (recurrence === 'none') {
        occurrences.push(copy);
        break;
      }
      if (recurrence === 'weekly') {
        copy.setDate(copy.getDate() + 7 * i);
      } else if (recurrence === 'monthly') {
        copy.setMonth(copy.getMonth() + i);
      }
      occurrences.push(copy);
    }
    return occurrences;
  }, [composedDate, previewCount, recurrence]);

  const markedDates = useMemo(() => {
    const obj: Record<string, any> = {};
    previewOccurrences.forEach((d) => {
      const key = d.toISOString().slice(0, 10);
      obj[key] = { marked: true, dotColor: '#2E86AB' };
    });
    return obj;
  }, [previewOccurrences]);

  // Optional calendar lib
  let CalendarList: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    CalendarList = require('react-native-calendars').CalendarList;
  } catch {
    CalendarList = null;
  }

  useEffect(() => {
    // On mount and when auth changes, fetch this user's created games
    fetchCreatedGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.currentUser?.uid]);

  // runtime-safe addDoc helper (works for native RN Firebase and web SDK)
  async function addDocSafe(collectionPath: string, data: any) {
    if (db && typeof (db as any).collection === 'function') {
      return (db as any).collection(collectionPath).add(data);
    } else {
      const { collection, addDoc } = await import('firebase/firestore');
      return addDoc(collection(db as any, collectionPath), data);
    }
  }

  // Create games for each preview occurrence
  async function createGames() {
    try {
      if (!auth || !auth.currentUser) {
        Toast.show({ type: 'error', text1: 'Sign in required', text2: 'Please sign in to create games.' });
        return;
      }
      setCreating(true);
      await ensureFirestoreOnline();

      const user = auth.currentUser;
      // Read user profile to check coordinator & team membership
      const userDoc = await getDocument(`users/${user.uid}`);
      if (!userDoc) {
        Toast.show({ type: 'error', text1: 'User record missing', text2: 'Cannot find user record.' });
        return;
      }
      const teamId = userDoc.teamId;
      const isCoordinator = !!userDoc.isCoordinator;
      if (!isCoordinator || !teamId) {
        Toast.show({ type: 'error', text1: 'Permission denied', text2: 'You must be a coordinator with a team to create games.' });
        return;
      }

      let created = 0;
      const defaultTitle = gameTitleText?.trim() ? gameTitleText.trim() : 'Available Game';

      for (const occ of previewOccurrences) {
        const payload: any = {
          teamId,
          title: defaultTitle,
          type: 'open',
          startISO: occ.toISOString(),
          location: null,
          kitColor: null,
          createdBy: user.uid,
          createdAt: new Date().toISOString(),
        };
        try {
          const ref: any = await addDocSafe('games', payload);
          // try to derive an id (web/native refs expose .id, sometimes path)
          const createdId = ref?.id ?? (typeof ref?.path === 'string' ? String(ref.path).split('/').pop() : null);
          console.log('[GameScheduler] added game', { createdId, payload });
          if (createdId) {
            created++;
            // Try to immediately read back the created doc (helps verify permissions & visibility)
            try {
              const doc = await getDocument(`games/${createdId}`);
              console.log('[GameScheduler] getDocument for created game returned', { createdId, doc });
              // If we got a doc back, immediately prepend it to createdGames so UI shows the new slot
              if (doc) {
                setCreatedGames((prev) => [
                  { id: createdId, title: doc.title, startISO: doc.startISO, location: doc.location, kitColor: doc.kitColor ?? null, teamId: doc.teamId, elo: doc.elo, createdBy: doc.createdBy },
                  ...prev,
                ]);
              }
            } catch (readErr) {
              console.warn('[GameScheduler] getDocument for created game failed', createdId, readErr);
            }
          } else {
            console.warn('[GameScheduler] addDoc returned no id for payload', payload, ref);
          }
        } catch (e) {
          console.warn('[GameScheduler] createGames addDoc failed for', payload, e);
        }
      }

      if (created > 0) {
        Toast.show({ type: 'success', text1: 'Games created', text2: `${created} game(s) created.` });
      } else {
        Toast.show({ type: 'info', text1: 'No games created', text2: 'None of the game documents could be created.' });
      }

      // Refresh created games list
      // Try to refresh the full createdGames list. This will log token info (helpful if the collection query is blocked).
      try {
        await debugAuthState('after createGames, before fetchCreatedGames');
      } catch {
        // ignore
      }
      fetchCreatedGames();
    } catch (e: any) {
      console.error('[GameScheduler] createGames error', e);
      Toast.show({ type: 'error', text1: 'Create failed', text2: e?.message ?? String(e) });
    } finally {
      setCreating(false);
    }
  }

  // Fetch games created by current user (REST). No server-side orderBy to avoid index requirement.
  async function fetchCreatedGames() {
    try {
      if (!auth || !auth.currentUser) {
        setCreatedGames([]);
        return;
      }
      setFetchingCreatedGames(true);
      await ensureFirestoreOnline();

      // diagnostic: log auth token & payload before running the collection query
      try {
        await debugAuthState('before fetchCreatedGames');
      } catch (dbgErr) {
        console.warn('[GameScheduler] debugAuthState failed', dbgErr);
      }

      const uid = auth.currentUser.uid;
      // Use REST runCollectionQuery to find games createdBy == uid
      const docs = await runCollectionQuery({
        collectionId: 'games',
        where: [{ fieldPath: 'createdBy', op: 'EQUAL', value: uid }],
        limit: 1000,
      });

      const items: Game[] = (docs as any[]).map((d) => ({
        id: d.id,
        title: d.title,
        startISO: d.startISO,
        location: d.location,
        kitColor: d.kitColor ?? null,
        teamId: d.teamId,
        elo: d.elo,
        createdBy: d.createdBy,
      }));

      // Client-side sort by startISO (docs without startISO go to the end)
      items.sort((a, b) => {
        if (!a.startISO && !b.startISO) return 0;
        if (!a.startISO) return 1;
        if (!b.startISO) return -1;
        return a.startISO.localeCompare(b.startISO);
      });

      setCreatedGames(items);
    } catch (e: any) {
      console.warn('[GameScheduler] fetchCreatedGames failed', e);
      setCreatedGames([]);
    } finally {
      setFetchingCreatedGames(false);
    }
  }

  // Render header (top controls + preview)
  function renderHeader() {
    return (
      <View style={{ paddingBottom: 12 }}>
        <Text style={styles.header}>Schedule a Game</Text>

        {/* date / time pickers */}
        <View style={styles.row}>
          <Pressable onPress={() => setShowDatePicker(true)} style={styles.pickerButton}>
            <Text style={styles.pickerText}>Date: {date.toDateString()}</Text>
          </Pressable>

          <Pressable onPress={() => setShowTimePicker(true)} style={styles.pickerButton}>
            <Text style={styles.pickerText}>
              Time: {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>
        </View>

        {showDatePicker && <DateTimePicker value={date} mode="date" display="default" onChange={(e, s) => { setShowDatePicker(false); if (s) setDate(s); }} />}
        {showTimePicker && <DateTimePicker value={time} mode="time" is24Hour={false} display="default" onChange={(e, s) => { setShowTimePicker(false); if (s) setTime(s); }} />}

        {/* recurrence */}
        <View style={styles.row}>
          <Pressable style={[styles.optionButton, recurrence === 'none' && styles.optionActive]} onPress={() => setRecurrence('none')}>
            <Text>Single</Text>
          </Pressable>
          <Pressable style={[styles.optionButton, recurrence === 'weekly' && styles.optionActive]} onPress={() => setRecurrence('weekly')}>
            <Text>Weekly</Text>
          </Pressable>
          <Pressable style={[styles.optionButton, recurrence === 'monthly' && styles.optionActive]} onPress={() => setRecurrence('monthly')}>
            <Text>Monthly</Text>
          </Pressable>
        </View>

        {/* Optional title moved under recurrence */}
        <View style={{ marginTop: 8 }}>
          <Text style={{ marginBottom: 6, fontSize: 14, fontWeight: '600' }}>Optional title for created games</Text>
          <TextInput
            value={gameTitleText}
            onChangeText={setGameTitleText}
            placeholder="e.g. Open Match / Practice"
            style={[styles.smallInput, { textAlign: 'left' }]}
            returnKeyType="done"
            accessibilityLabel="Optional game title"
          />
          <Text style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
            Leave empty to use the default title "Available Game".
          </Text>
        </View>

        {/* calendar preview or fallback */}
        <View style={styles.preview}>
          <Text style={styles.subHeader}>Preview ({previewOccurrences.length})</Text>
          {CalendarList ? (
            <CalendarList
              horizontal
              pastScrollRange={0}
              futureScrollRange={6}
              markedDates={markedDates}
              markingType="multi-dot"
              style={{ borderRadius: 8, marginVertical: 8 }}
            />
          ) : (
            <View style={{ marginVertical: 8 }}>
              <Text style={{ color: '#666' }}>Install react-native-calendars for a calendar preview (optional)</Text>
            </View>
          )}

          <View style={styles.previewWrap}>
            {previewOccurrences.map((d) => (
              <View key={d.toISOString()} style={styles.previewRow}>
                <Text>{d.toLocaleString()}</Text>
              </View>
            ))}
          </View>

          {/* Confirm create availability button */}
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <Pressable
              onPress={createGames}
              style={[styles.loadMore, { paddingHorizontal: 18, backgroundColor: '#0a7ea4' }]}
              disabled={creating}
            >
              {creating ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white' }}>Confirm & Create Availability</Text>}
            </Pressable>
          </View>

          {/* Find Games button: navigates to the read-only FindGames screen */}
          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <Pressable onPress={() => router.push('/(tabs)/FindGamesScreen')} style={[styles.smallBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#0a7ea4' }]}>
              <Text style={[styles.smallBtnText, { color: '#0a7ea4' }]}>Find Games</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={[]} // no in-page available games anymore; header contains scheduler UI
        renderItem={() => null}          // <- add this no-op renderItem to satisfy types
        ListHeaderComponent={renderHeader}
        ListFooterComponent={() => (
          <View style={{ padding: 16 }}>
            <Text style={{ fontWeight: '700', marginBottom: 8 }}>Your created games</Text>
            {fetchingCreatedGames ? (
              <ActivityIndicator />
            ) : createdGames.length === 0 ? (
              <Text style={{ color: '#666' }}>No games created by you</Text>
            ) : (
              <FlatList
                data={createdGames}
                keyExtractor={(i) => i.id}
                renderItem={({ item }) => (
                  <View style={{ padding: 8, borderWidth: 1, borderColor: '#eee', borderRadius: 6, marginBottom: 8 }}>
                    <Text style={{ fontWeight: '600' }}>{item.title}</Text>
                    <Text style={{ color: '#666' }}>{item.startISO ? new Date(item.startISO).toLocaleString() : 'TBA'}</Text>
                    <Text style={{ color: '#666' }}>Team: {item.teamId ?? '—'}</Text>
                  </View>
                )}
              />
            )}
          </View>
        )}
        contentContainerStyle={{ padding: 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { fontSize: 20, fontWeight: '700', marginBottom: 8, paddingTop: 8 },
  subHeader: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  pickerButton: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  pickerText: { fontSize: 14 },
  optionButton: { padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#ddd', marginRight: 8 },
  optionActive: { backgroundColor: '#e6f4fe', borderColor: '#2e86ab' },
  preview: { marginTop: 8 },
  previewWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  previewRow: { padding: 6, borderRadius: 6, backgroundColor: '#f4f4f4', marginRight: 8, marginBottom: 8 },
  gameCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    marginHorizontal: 6,
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
  },
  colorPill: { width: 28, height: 6, borderRadius: 4, marginBottom: 8 },
  gameTitle: { fontSize: 14, fontWeight: '600' },
  gameMeta: { fontSize: 12, color: '#555' },
  loadMore: { backgroundColor: '#2E86AB', padding: 10, borderRadius: 6, alignItems: 'center' },
  modal: { flex: 1, padding: 16, backgroundColor: '#fff' },
  contactBtn: { marginTop: 12, backgroundColor: '#2E86AB', padding: 10, borderRadius: 6, alignItems: 'center' },
  closeBtn: { marginTop: 12, padding: 8, alignItems: 'center' },
  smallBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
    marginHorizontal: 4,
  },
  smallBtnText: {
    color: 'white',
    fontWeight: '600',
  },
  smallInput: {
    minWidth: 84,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
    marginHorizontal: 4,
  },
  helperText: {
    color: '#666',
    fontSize: 12,
    marginTop: 6,
  },
});