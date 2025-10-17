import { auth } from '@/firebaseConfig';
import { signOut } from 'firebase/auth';
import React from 'react';
import { Button, View } from 'react-native';

export default function HomeScreen() {
  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('User signed out');
      // 👇 do NOT navigate manually; _layout.tsx will handle it
    } catch (error: any) {
      console.error('Logout failed:', error.message);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Button title="Logout" onPress={handleLogout} />
    </View>
  );
}