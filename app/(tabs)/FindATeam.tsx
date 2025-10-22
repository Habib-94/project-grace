import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import { addDoc, collection } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { debugAuthState, getDocument, queryTeams, runCollectionQuery } from '../../src/firestoreRest';

// Team type includes rating (previously called ELO)
interface Team {
  id: string;
  teamName: string;
  location?: string;
  homeColor?: string;
  awayColor?: string;
  elo?: number; // numeric score stored in Firestore; UI label will show "Rating"
}

export default function FindATeam() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sending, setSending] = useState(false);

  // Directory list (defaults shown when search empty)
  const [directory, setDirectory] = useState<Team[]>([]);
  const [dirLoading, setDirLoading] = useState(false);

  const user = auth.currentUser;
  const router = useRouter();

  // debounce ref
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    // load initial directory (top teams)
    fetchDirectory();
    // cleanup debounce on unmount
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    // Incremental search: debounce user input
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!searchTerm.trim()) {
        // show directory when empty
        setResults([]);
        return;
      }
      handleSearch(searchTerm.trim());
    }, 300) as unknown as number;
  }, [searchTerm]);

  const normalizeDocToTeam = (d: any): Team | null => {
    if (!d || !d.id) return null;
    return {
      id: String(d.id),
      teamName: String(d.teamName ?? ''),
      location: d.location ?? undefined,
      homeColor: d.homeColor ?? undefined,
      awayColor: d.awayColor ?? undefined,
      elo: d?.elo != null ? Number(d.elo) : undefined,
    };
  };

  const fetchDirectory = async () => {
    setDirLoading(true);
    try {
      await ensureFirestoreOnline();

      // diagnostic: log auth/token presence before query
      try {
        const dbg = await debugAuthState('FindATeam.fetchDirectory');
        console.log('[FindATeam] debugAuthState:', dbg);
      } catch (dbgErr) {
        console.warn('[FindATeam] debugAuthState failed', dbgErr);
      }

      const docs = await queryTeams({ limit: 50 });
      const items = (docs as any[]).map((d: any) => normalizeDocToTeam(d)).filter(Boolean) as Team[];
      setDirectory(items);
    } catch (e: any) {
      console.error('Failed to load directory', e);
      Toast.show({ type: 'error', text1: 'Failed to load teams', text2: e?.message ?? String(e) });
      setDirectory([]);
    } finally {
      setDirLoading(false);
    }
  };

  const handleSearch = async (term?: string) => {
    const qTerm = term ?? searchTerm;
    if (!qTerm.trim()) return;
    setSearching(true);
    setResults([]);
    setSelectedTeam(null);

    try {
      await ensureFirestoreOnline();

      const docs = await runCollectionQuery({
        collectionId: 'teams',
        // helper expects arrays for where/orderBy
        where: [{ fieldPath: 'teamName', op: 'GREATER_THAN_OR_EQUAL', value: qTerm }],
        orderBy: [{ fieldPath: 'teamName', direction: 'ASCENDING' }],
        limit: 50,
      });

      const teams = (docs as any[]).map((d: any) => normalizeDocToTeam(d)).filter(Boolean) as Team[];
      setResults(teams);

      if (teams.length === 0) {
        Toast.show({ type: 'info', text1: 'No teams found', text2: 'Try another name.' });
      }
    } catch (e: any) {
      console.error('❌ Error searching teams:', e);
      Toast.show({ type: 'error', text1: 'Error', text2: e.message });
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async () => {
    if (!selectedTeam) {
      Toast.show({ type: 'info', text1: 'Select a team first' });
      return;
    }
    if (!user) {
      router.replace('/(auth)/LoginScreen');
      return;
    }

    try {
      setSending(true);
      await ensureFirestoreOnline();

      // read user via REST helper
      const userDoc = await getDocument(`users/${user.uid}`);

      if (!userDoc) {
        Alert.alert('Error', 'User record not found.');
        return;
      }

      const userData = userDoc as any;

      if (userData.teamId) {
        Toast.show({
          type: 'error',
          text1: 'Already in a team',
          text2: 'You must leave your current team first.',
        });
        return;
      }

      // Prevent duplicate requests: use REST helper to fetch recent requests and filter client-side
      const reqDocs = await runCollectionQuery({
        collectionId: 'requests',
        limit: 200,
      });
      const duplicate = (reqDocs as any[]).some(
        (r: any) => r.userId === user.uid && r.teamId === selectedTeam.id && r.status === 'pending'
      );

      if (duplicate) {
        Toast.show({
          type: 'info',
          text1: 'Request already sent',
          text2: 'Please wait for approval.',
        });
        return;
      }

      // ✅ Create join request (write still uses Firestore write API)
      await addDoc(collection(db, 'requests'), {
        userId: user.uid,
        userEmail: user.email ?? '',
        teamId: selectedTeam.id,
        teamName: selectedTeam.teamName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      Toast.show({
        type: 'success',
        text1: 'Request sent!',
        text2: 'The team coordinator will review your request.',
      });

      // Redirect user back to the tabs root (index) after sending a join request
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('❌ Error sending request:', e);
      Toast.show({
        type: 'error',
        text1: 'Error sending request',
        text2: e.message || 'Something went wrong.',
      });
    } finally {
      setSending(false);
    }
  };

  const renderTeamCard = ({ item }: { item: Team }) => {
    const rating = Math.min(Math.max(item.elo ?? 1500, 800), 3000);
    return (
      <TouchableOpacity style={styles.teamCard} onPress={() => setSelectedTeam(item)}>
        <Text style={styles.teamName}>{item.teamName}</Text>
        {item.location ? <Text style={styles.teamLocation}>{item.location}</Text> : null}
        <Text style={styles.teamRating}>Rating: {rating}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Find a Team</Text>

      {/* Search input - incremental */}
      <View style={styles.searchSection}>
        <TextInput
          style={styles.input}
          placeholder="Search teams by name..."
          value={searchTerm}
          onChangeText={setSearchTerm}
          returnKeyType="search"
          onSubmitEditing={() => handleSearch(searchTerm)}
        />
        <Button title="Search" onPress={() => handleSearch(searchTerm)} disabled={searching} />
      </View>

      {/* Preview results when searching */}
      {searching && <ActivityIndicator size="small" color="#0a7ea4" style={{ marginTop: 12 }} />}

      {results.length > 0 && !selectedTeam ? (
        <View style={{ marginTop: 12, width: '100%' }}>
          <Text style={styles.sectionTitle}>Search results</Text>
          <FlatList
            data={results}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderTeamCard}
            scrollEnabled={false}
          />
        </View>
      ) : null}

      {/* Directory fallback when no search term */}
      {!searchTerm.trim() && (
        <View style={{ marginTop: 12, width: '100%' }}>
          <Text style={styles.sectionTitle}>Team directory</Text>
          {dirLoading ? (
            <ActivityIndicator size="small" color="#0a7ea4" style={{ marginTop: 12 }} />
          ) : directory.length === 0 ? (
            <Text style={{ color: '#666' }}>No teams available</Text>
          ) : (
            <FlatList
              data={directory}
              keyExtractor={(i) => String(i.id)}
              renderItem={renderTeamCard}
              scrollEnabled={false}
            />
          )}
        </View>
      )}

      {/* Selected team preview & request button */}
      {selectedTeam && (
        <View style={styles.selectedContainer}>
          <Text style={styles.selectedTitle}>Selected Team</Text>
          <Text style={styles.teamName}>{selectedTeam.teamName}</Text>
          {selectedTeam.location && <Text style={styles.teamLocation}>{selectedTeam.location}</Text>}
          <Text style={{ marginTop: 6 }}>Rating: {Math.min(Math.max(selectedTeam.elo ?? 1500, 800), 3000)}</Text>

          <View style={{ marginTop: 15 }}>
            <Button
              title={sending ? 'Sending...' : 'Request to Join'}
              onPress={handleSendRequest}
              disabled={sending}
              color="#0a7ea4"
            />
          </View>

          <View style={{ marginTop: 10 }}>
            <Button title="Cancel" onPress={() => setSelectedTeam(null)} color="#FF3B30" />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0a7ea4', marginBottom: 8 },
  searchSection: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 6 },
  teamCard: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#f9f9f9',
  },
  teamName: { fontSize: 18, fontWeight: 'bold', color: '#0a7ea4' },
  teamLocation: { fontSize: 14, color: '#666' },
  teamRating: { marginTop: 6, fontSize: 14, color: '#333', fontWeight: '600' },
  selectedContainer: { marginTop: 20 },
  selectedTitle: { fontSize: 20, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
});