// app/(tabs)/RequestCoordinatorScreen.tsx
import { auth, db } from '@/firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import React from 'react';
import { Button, Text, View } from 'react-native';

export default function RequestCoordinatorScreen() {
  const handleRequest = async () => {
    const user = auth.currentUser;
    if (!user) return alert('Not logged in');

    await updateDoc(doc(db, 'users', user.uid), {
      pendingTeamRequest: 'coordinator', // signal admin or old coordinator
    });

    alert('Coordinator request sent!');
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Request Game Coordinator Role</Text>
      <Button title="Send Request" onPress={handleRequest} />
    </View>
  );
}
