// app/(tabs)/JoinTeamScreen.tsx
import { auth, db, ensureFirestoreOnline } from '@/firebaseConfig';
import { useRouter } from 'expo-router';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
} from 'firebase/firestore';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Button,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import Toast from 'react-native-toast-message';

// ✅ Define a proper TypeScript interface for teams
interface Team {
  id: string;
  teamName: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeColor?: string;
  awayColor?: string;
}

export default function JoinTeamScreen() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sending, setSending] = useState(false);

  const user = auth.currentUser;
  const router = useRouter();

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    setResults([]);
    setSelectedTeam(null);

    try {
      await ensureFirestoreOnline();

      const teamQuery = query(
        collection(db, 'teams'),
        where('teamName', '>=', searchTerm),
        where('teamName', '<=', searchTerm + '\uf8ff')
      );

      const snap = await getDocs(teamQuery);
      const teams: Team[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        teams.push({
          id: docSnap.id,
          teamName: data.teamName,
          location: data.location,
          latitude: data.latitude,
          longitude: data.longitude,
          homeColor: data.homeColor,
          awayColor: data.awayColor,
        });
      });

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
    if (!selectedTeam || !user) return;

    try {
      setSending(true);
      await ensureFirestoreOnline();

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        Alert.alert('Error', 'User record not found.');
        return;
      }

      const userData = userSnap.data();

      if (userData.teamId) {
        Toast.show({
          type: 'error',
          text1: 'Already in a team',
          text2: 'You must leave your current team first.',
        });
        return;
      }

      // Prevent duplicate requests
      const existingRequests = await getDocs(
        query(
          collection(db, 'requests'),
          where('userId', '==', user.uid),
          where('teamId', '==', selectedTeam.id),
          where('status', '==', 'pending')
        )
      );

      if (!existingRequests.empty) {
        Toast.show({
          type: 'info',
          text1: 'Request already sent',
          text2: 'Please wait for approval.',
        });
        return;
      }

      // ✅ Create join request
      await addDoc(collection(db, 'requests'), {
        userId: user.uid,
        userEmail: user.email,
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

      router.replace('/(tabs)/ManageTeamScreen');
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Join a Team</Text>

      <View style={styles.searchSection}>
        <TextInput
          style={styles.input}
          placeholder="Enter team name..."
          value={searchTerm}
          onChangeText={setSearchTerm}
        />
        <Button title="Search" onPress={handleSearch} disabled={searching} />
      </View>

      {searching && <ActivityIndicator size="large" color="#0a7ea4" style={{ marginTop: 20 }} />}

      {!selectedTeam && results.length > 0 && (
        <View style={{ marginTop: 20 }}>
          {results.map((team) => (
            <TouchableOpacity
              key={team.id}
              style={styles.teamCard}
              onPress={() => setSelectedTeam(team)}
            >
              <Text style={styles.teamName}>{team.teamName}</Text>
              {team.location && <Text style={styles.teamLocation}>{team.location}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selectedTeam && (
        <View style={styles.selectedContainer}>
          <Text style={styles.selectedTitle}>Selected Team</Text>
          <Text style={styles.teamName}>{selectedTeam.teamName}</Text>
          {selectedTeam.location && <Text style={styles.teamLocation}>{selectedTeam.location}</Text>}

          {selectedTeam.latitude !== undefined && selectedTeam.longitude !== undefined && (
            <MapView
              style={styles.map}
              region={{
                latitude: selectedTeam.latitude,
                longitude: selectedTeam.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              <Marker
                coordinate={{
                  latitude: selectedTeam.latitude,
                  longitude: selectedTeam.longitude,
                }}
                title={selectedTeam.teamName}
              />
            </MapView>
          )}

          <View style={{ marginTop: 15 }}>
            <Button
              title={sending ? 'Sending...' : 'Request to Join'}
              onPress={handleSendRequest}
              disabled={sending}
              color="#0a7ea4"
            />
          </View>

          <View style={{ marginTop: 10 }}>
            <Button
              title="Cancel"
              onPress={() => setSelectedTeam(null)}
              color="#FF3B30"
            />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0a7ea4', textAlign: 'center', marginBottom: 20 },
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
  selectedContainer: { marginTop: 30 },
  selectedTitle: { fontSize: 20, fontWeight: '600', marginBottom: 10, textAlign: 'center' },
  map: { width: '100%', height: 200, borderRadius: 10, marginTop: 10 },
});
