// app/(tabs)/EditTeamsScreen.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function EditTeamsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Edit Teams Screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 20,
    color: '#0a7ea4',
  },
});