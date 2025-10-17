import { auth, db } from '@/firebaseConfig';
import { addDoc, collection } from 'firebase/firestore';
import React, { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

export default function CalendarScreen() {
  const [gameTime, setGameTime] = useState('');

  const handleAdd = async () => {
    if (!gameTime) return;
    await addDoc(collection(db, 'gameTimes'), {
      teamId: auth.currentUser?.uid,
      teamName: auth.currentUser?.email,
      availableDateTime: gameTime,
      status: 'open',
    });
    setGameTime('');
    alert('Game time added!');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add Available Game Time</Text>
      <TextInput
        placeholder="YYYY-MM-DD HH:MM"
        value={gameTime}
        onChangeText={setGameTime}
        style={styles.input}
      />
      <Button title="Add" onPress={handleAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  input: { borderWidth: 1, padding: 10, marginBottom: 10 },
  title: { fontSize: 20, textAlign: 'center', marginBottom: 20 },
});
