import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Toast from 'react-native-toast-message';
import { auth, db, ensureFirestoreOnline } from '../../src/firebaseConfig'; // db/auth/ensure helper
import { debugAuthState, getDocument, listTopLevelCollection, runCollectionQuery } from '../../src/firestoreRest';

// Minimal types for this screen
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

  // Optional title for created games
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

  // selection & status tracking for preview occurrences
  const [selectedOccurrences, setSelectedOccurrences] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    previewOccurrences.forEach((d) => {
      init[d.toISOString()] = true; // default: select all
    });
    return init;
  });

  // statuses per occurrence: 'idle' | 'pending' | 'success' | 'error'
  const [creationStatus, setCreationStatus] = useState<Record<string, 'idle' | 'pending' | 'success' | 'error'>>({});

  // simple progress counters shown in the button/progress bar
  const [totalToCreate, setTotalToCreate] = useState<number>(0);
  const [createdCount, setCreatedCount] = useState<number>(0);

  // reset selection/status when preview occurrences change
  useEffect(() => {
    const init: Record<string, boolean> = {};
    previewOccurrences.forEach((d) => (init[d.toISOString()] = true));
    setSelectedOccurrences(init);
    setCreationStatus({});
    setTotalToCreate(0);
    setCreatedCount(0);
  }, [previewOccurrences]);

  // compute markedDates for CalendarList, reflecting:
  // - occurrences selected for creation (highlight blue)
  // - per-occurrence status (pending/orange, success/green, error/red)
  // - already-created games (red)
  const markedDates = useMemo(() => {
    const obj: Record<string, any> = {};

    // Mark preview occurrences first (so their selection/status drives styling)
    previewOccurrences.forEach((d) => {
      const iso = d.toISOString();
      const key = iso.slice(0, 10); // YYYY-MM-DD
      const isSelected = !!selectedOccurrences[iso];
      const status = creationStatus[iso] ?? 'idle';
      const alreadyCreated = createdGames.some((g) => g.startISO === iso);

      // defaults
      let dotColor = '#2E86AB';
      let selected = false;
      let selectedColor: string | undefined = undefined;

      if (alreadyCreated) {
        // already-created: red highlight
        dotColor = '#FF3B30';
        selected = true;
        selectedColor = '#fff1f0';
      } else if (status === 'pending') {
        dotColor = '#f0ad4e'; // orange
        selected = true;
        selectedColor = '#fff8e6';
      } else if (status === 'success') {
        dotColor = '#28a745'; // green
        selected = true;
        selectedColor = '#ecffef';
      } else if (status === 'error') {
        dotColor = '#b00020'; // dark red
        selected = true;
        selectedColor = '#fff1f0';
      } else if (isSelected) {
        // selected for future creation
        dotColor = '#054f73';      // darker blue
        selected = true;
        selectedColor = '#d7eef6'; // slightly darker selected background
      } else {
        // non-selected preview
        dotColor = '#2E86AB';
        selected = false;
      }

      // accumulate: if multiple occurrences fall on same day, prefer red/success/pending ordering
      const existing = obj[key];
      if (!existing) {
        obj[key] = { marked: true, dotColor, selected, selectedColor };
      } else {
        // if existing is already red (created) keep it; otherwise prefer more urgent color
        const priority = (c: string) => {
          if (c === '#FF3B30' || c === '#b00020') return 4;
          if (c === '#f0ad4e') return 3;
          if (c === '#28a745') return 2;
          if (c === '#0a7ea4') return 1;
          return 0;
        };
        const existingPriority = priority(existing.dotColor);
        const newPriority = priority(dotColor);
        if (newPriority >= existingPriority) {
          obj[key] = { marked: true, dotColor, selected: existing.selected || selected, selectedColor: selectedColor ?? existing.selectedColor };
        }
      }
    });

    // Also mark any createdGames that are on dates not in previewOccurrences
    createdGames.forEach((g) => {
      if (!g.startISO) return;
      const key = new Date(g.startISO).toISOString().slice(0, 10);
      const existing = obj[key];
      if (!existing) {
        obj[key] = { marked: true, dotColor: '#FF3B30', selected: true, selectedColor: '#fff1f0' };
      } else {
        // prefer red if a created game exists on the day
        obj[key] = { ...existing, dotColor: '#FF3B30', selected: true, selectedColor: '#fff1f0' };
      }
    });

    return obj;
  }, [previewOccurrences, selectedOccurrences, creationStatus, createdGames]);

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

  // runtime-safe delete helper (same pattern as other safe helpers)
  async function deleteDocSafe(path: string) {
    const parts = path.split('/');
    const col = parts[0];
    const id = parts[1];
    if (!col || !id) throw new Error('deleteDocSafe expects "collection/docId" path');

    if (db && typeof (db as any).collection === 'function') {
      return (db as any).collection(col).doc(id).delete();
    } else {
      const { doc, deleteDoc } = await import('firebase/firestore');
      return deleteDoc(doc(db as any, col, id));
    }
  }

  // Confirm + delete a created game, update UI
  function deleteCreatedGame(id: string) {
    if (!id) return;
    Alert.alert(
      'Delete Game',
      'Are you sure you want to delete this game? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await ensureFirestoreOnline();
              await deleteDocSafe(`games/${id}`);
              setCreatedGames((prev) => prev.filter((g) => g.id !== id));
              Toast.show({ type: 'info', text1: 'Game removed' });
            } catch (e: any) {
              console.error('[GameScheduler] deleteCreatedGame failed', e);
              Toast.show({ type: 'error', text1: 'Delete failed', text2: e?.message ?? '' });
            }
          },
        },
      ],
      { cancelable: true }
    );
  }

  // Create games for each preview occurrence
  async function createGames() {
    try {
      if (!auth || !auth.currentUser) {
        Toast.show({ type: 'error', text1: 'Sign in required', text2: 'Please sign in to create games.' });
        return;
      }

      // Build list of occurrences selected
      const selectedIsos = previewOccurrences
        .map((d) => d.toISOString())
        .filter((iso) => selectedOccurrences[iso]);

      if (selectedIsos.length === 0) {
        Toast.show({ type: 'info', text1: 'No occurrences selected', text2: 'Please select at least one occurrence to create.' });
        return;
      }

      setCreating(true);
      await ensureFirestoreOnline();

      const user = auth.currentUser;
      // Read user profile to check coordinator & team membership
      const userDoc = await getDocument(`users/${user.uid}`);
      if (!userDoc) {
        Toast.show({ type: 'error', text1: 'User record missing', text2: 'Cannot find user record.' });
        setCreating(false);
        return;
      }
      const teamId = userDoc.teamId;
      const isCoordinator = !!userDoc.isCoordinator;
      if (!isCoordinator || !teamId) {
        Toast.show({ type: 'error', text1: 'Permission denied', text2: 'You must be a coordinator with a team to create games.' });
        setCreating(false);
        return;
      }

      // try to read team doc to get coordinates/label
      let teamName = '';
      let teamLat: number | null = null;
      let teamLng: number | null = null;
      let teamLabel = '';
      let teamPlaceId = '';

      try {
        const teamDoc = await getDocument(`teams/${teamId}`);
        teamName = (teamDoc?.teamName as string) ?? '';
        teamLat = teamDoc?.latitude ?? teamDoc?.lat ?? null;
        teamLng = teamDoc?.longitude ?? teamDoc?.lng ?? null;
        teamLabel = (teamDoc?.location as string) ?? '';
        teamPlaceId = (teamDoc?.placeId as string) ?? '';
      } catch (e) {
        // ignore; best-effort enrichment
      }

      // Initialize statuses
      const newStatus: Record<string, 'idle' | 'pending' | 'success' | 'error'> = {};
      selectedIsos.forEach((iso) => {
        newStatus[iso] = 'pending';
      });
      setCreationStatus((prev) => ({ ...prev, ...newStatus }));
      setTotalToCreate(selectedIsos.length);
      setCreatedCount(0);

      const defaultTitle = gameTitleText?.trim() ? gameTitleText.trim() : 'Available Game';

      // Iterate sequentially to provide clearer per-item statuses (you can parallelize later)
      let successCount = 0;
      for (const iso of selectedIsos) {
        try {
          const occ = new Date(iso);
          const payload: any = {
            teamId,
            title: defaultTitle,
            type: 'open',
            startISO: occ.toISOString(),
            location: teamLat != null && teamLng != null ? { lat: teamLat, lng: teamLng, label: teamLabel } : null,
            placeId: teamPlaceId ?? null,
            kitColor: null,
            createdBy: user.uid,
            createdAt: new Date().toISOString(),
          };

          // mark pending
          setCreationStatus((prev) => ({ ...prev, [iso]: 'pending' }));

          // Attempt SDK-first addDoc
          let ref: any = null;
          try {
            ref = await addDocSafe('games', payload);
          } catch (sdkErr) {
            // SDK write failed — mark this occurrence as error and continue.
            // If you want a REST fallback, implement it here using your existing helpers in src/firestoreRest.ts.
            console.warn('[GameScheduler] addDoc SDK failed, no fallback implemented here', sdkErr);
            throw sdkErr; // this will be caught by the per-item catch below and set status='error'
          }

          // If add succeeded and returned an id, we can fetch document or use payload to immediately reflect created item
          const createdId = ref?.id ?? (typeof ref?.path === 'string' ? String(ref.path).split('/').pop() : null);

          // optimistic UI: insert a record into createdGames (the list shown below) so user sees immediate result
          const createdItem: Game = {
            id: createdId ?? `local-${Math.random().toString(36).slice(2, 9)}`,
            title: payload.title,
            startISO: payload.startISO,
            location: payload.location,
            kitColor: payload.kitColor,
            teamId: payload.teamId,
            teamName: teamName,
            teamLocation: teamLabel,
            type: payload.type,
            elo: undefined,
            createdBy: payload.createdBy,
          };

          setCreatedGames((prev) => [createdItem, ...prev]);

          // mark success
          setCreationStatus((prev) => ({ ...prev, [iso]: 'success' }));
          successCount++;
          setCreatedCount((c) => c + 1);
        } catch (itemErr: any) {
          console.warn('[GameScheduler] failed to create occurrence', iso, itemErr);
          setCreationStatus((prev) => ({ ...prev, [iso]: 'error' }));
        }
      }

      if (successCount > 0) {
        Toast.show({ type: 'success', text1: 'Games created', text2: `${successCount} game(s) created.` });
      } else {
        Toast.show({ type: 'error', text1: 'Create failed', text2: 'None of the selected occurrences could be created.' });
      }

      // Refresh created games list (best-effort)
      try {
        await debugAuthState('after createGames, before fetchCreatedGames');
      } catch {
        // ignore
      }
      await fetchCreatedGames();
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

      // Prefer listing the top-level collection (avoids runQuery structuredQuery + rules mismatch)
      let docs: any[] = [];
      try {
        docs = await listTopLevelCollection('games', 1000);
      } catch (listErr) {
        console.warn('[GameScheduler] listTopLevelCollection failed, falling back to runCollectionQuery', listErr);
        // Fallback: try the structured runQuery as before (may still be blocked by rules)
        try {
          docs = await runCollectionQuery({
            collectionId: 'games',
            where: [{ fieldPath: 'createdBy', op: 'EQUAL', value: uid }],
            limit: 1000,
          });
        } catch (qErr) {
          console.warn('[GameScheduler] runCollectionQuery fallback failed', qErr);
          docs = [];
        }
      }

      // Keep only docs created by current user
      const myDocs = (docs as any[]).filter((d) => d?.createdBy === uid);

      // Collect unique teamIds present in the results
      const teamIds = Array.from(new Set(myDocs.map((d) => d?.teamId).filter(Boolean)));

      // Fetch team docs in parallel to get the team's name + location (if available)
      const teamInfoMap: Record<string, { name: string; location: string }> = {};
      if (teamIds.length) {
        await Promise.all(
          teamIds.map(async (tid) => {
            try {
              const teamDoc = await getDocument(`teams/${tid}`);
              teamInfoMap[tid] = {
                name: (teamDoc?.teamName as string) ?? '',
                location: (teamDoc?.location as string) ?? '',
              };
            } catch (e) {
              console.warn('[GameScheduler] failed to read team doc for', tid, e);
              teamInfoMap[tid] = { name: '', location: '' };
            }
          })
        );
      }

      // Map into typed items and attach teamLocation (falls back to game's own location.label)
      const items: Game[] = myDocs
        .map((d) => ({
          id: d.id,
          title: d.title,
          startISO: d.startISO,
          location: d.location,
          kitColor: d.kitColor ?? null,
          teamId: d.teamId,
          teamName: d.teamId ? teamInfoMap[d.teamId]?.name ?? '' : '',
          teamLocation: d.teamId ? teamInfoMap[d.teamId]?.location ?? '' : (d.location?.label ?? ''),
          type: d.type ?? 'open',
          elo: d.elo,
          createdBy: d.createdBy,
        }))
        // Client-side sort by startISO (docs without startISO go to the end)
        .sort((a, b) => {
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
              // Theme: use the darker selection blue so calendar preview matches the row highlight
              theme={{
                selectedDayBackgroundColor: '#054f73',
                selectedDayTextColor: '#ffffff',
                dotColor: '#054f73',
                selectedDotColor: '#ffffff',
                todayTextColor: '#054f73',
              }}
              style={{ borderRadius: 8, marginVertical: 8 }}
            />
          ) : (
            <View style={{ marginVertical: 8 }}>
              <Text style={{ color: '#666' }}>Install react-native-calendars for a calendar preview (optional)</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Text style={{ fontSize: 13 }}>{previewOccurrences.length} occurrence(s)</Text>
            <Pressable
              onPress={() => { /* toggle logic */ }}
            >
              <Text style={{ color: '#054f73', fontWeight: '600' }}>{previewOccurrences.every((d) => selectedOccurrences[d.toISOString()]) ? 'Deselect all' : 'Select all'}</Text>
            </Pressable>
          </View>

          <View style={styles.previewWrap}>
            {previewOccurrences.map((d) => {
              const iso = d.toISOString();
              const isSelected = !!selectedOccurrences[iso];
              const status = creationStatus[iso] ?? 'idle';
              const alreadyCreated = createdGames.some((g) => g.startISO === iso);

              // compute background for row based on status / selection / alreadyCreated
              let bg = '#f4f4f4';
              if (alreadyCreated) bg = '#fff1f0'; // light red
              else if (status === 'pending') bg = '#fff8e6'; // light orange
              else if (status === 'success') bg = '#ecffef'; // light green
              else if (status === 'error') bg = '#fff1f0'; // light red
              else if (isSelected) bg = '#d7eef6'; // darker, more visible light blue

              return (
                <Pressable
                  key={iso}
                  onPress={() => setSelectedOccurrences((prev) => ({ ...prev, [iso]: !prev[iso] }))}
                  style={[styles.previewRow, { flexDirection: 'row', alignItems: 'center', minWidth: 200, backgroundColor: bg }]}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 3,
                      borderWidth: 1,
                      borderColor: isSelected ? '#054f73' : '#ccc',
                      backgroundColor: isSelected ? '#054f73' : '#fff',
                      marginRight: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSelected ? <Text style={{ color: 'white', fontSize: 12 }}>✓</Text> : null}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600' }}>{d.toDateString()}</Text>
                    <Text style={{ color: '#666', fontSize: 12 }}>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>

                  <View style={{ marginLeft: 8 }}>
                    {status === 'pending' ? (
                      <ActivityIndicator size="small" />
                    ) : status === 'success' ? (
                      <Text style={{ color: 'green', fontWeight: '600' }}>Created</Text>
                    ) : status === 'error' ? (
                      <Text style={{ color: '#b00020', fontWeight: '600' }}>Failed</Text>
                    ) : alreadyCreated ? (
                      <Text style={{ color: '#b00020', fontWeight: '600' }}>Already created</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Confirm create availability button */}
          <View style={{ marginTop: 10, alignItems: 'center' }}>
            <Pressable
              onPress={createGames}
              style={[
                styles.loadMore,
                { paddingHorizontal: 18, backgroundColor: creating ? '#999' : '#0a7ea4', flexDirection: 'row', alignItems: 'center' },
              ]}
              disabled={creating}
            >
              {creating ? (
                <>
                  <ActivityIndicator color="white" style={{ marginRight: 8 }} />
                  <Text style={{ color: 'white' }}>{`Creating ${createdCount}/${totalToCreate || previewOccurrences.length}`}</Text>
                </>
              ) : (
                <Text style={{ color: 'white' }}>{`Create ${Object.values(selectedOccurrences).filter(Boolean).length || 0} occurrence(s)`}</Text>
              )}
            </Pressable>
          </View>

          {/* small progress indicator */}
          {creating && totalToCreate > 0 ? (
            <View style={{ marginTop: 8, height: 6, width: '100%', backgroundColor: '#eee', borderRadius: 4 }}>
              <View style={{ width: `${Math.round((createdCount / totalToCreate) * 100)}%`, height: '100%', backgroundColor: '#2E86AB', borderRadius: 4 }} />
            </View>
          ) : null}

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
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderHeader()}

        <View style={{ padding: 16 }}>
          <Text style={{ fontWeight: '700', marginBottom: 8 }}>Your created games</Text>
          {fetchingCreatedGames ? (
            <ActivityIndicator />
          ) : createdGames.length === 0 ? (
            <Text style={{ color: '#666' }}>No games created by you</Text>
          ) : (
            createdGames.map((item) => {
              const dt = item.startISO ? new Date(item.startISO) : null;
              const title = item.title ?? 'Game';
              const typeLabel = (item.type ?? '').toString().toUpperCase() || 'N/A';

              return (
                <View key={item.id} style={styles.gameCard}>
                  {/* Delete button top-right */}
                  <View style={{ position: 'absolute', right: 10, top: 10 }}>
                    <Pressable onPress={() => deleteCreatedGame(item.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#FF3B30', borderRadius: 6 }}>
                      <Text style={{ color: 'white', fontWeight: '600' }}>Delete</Text>
                    </Pressable>
                  </View>

                  {/* kit color pill */}
                  <View style={[styles.colorPill, { backgroundColor: item.kitColor ?? '#ccc', marginBottom: 8 }]} />

                  <Text style={styles.gameTitle}>{title}</Text>

                  {/* main meta: date and type */}
                  <Text style={styles.gameMeta}>{dt ? dt.toLocaleString() : 'TBA'} • {typeLabel}</Text>

                  {/* Team and Team Location (prefer attached teamLocation, else fall back to game's own location.label or teamId) */}
                  <Text style={styles.gameMeta}>Team: {item.teamName ?? item.teamId ?? '—'}</Text>
                  <Text style={styles.gameMeta}>
                    Location: {item.teamLocation ? item.teamLocation : (item.location?.label ?? '—')}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
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
  previewRow: { padding: 6, borderRadius: 6, marginRight: 8, marginBottom: 8 },
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