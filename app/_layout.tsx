import { AuthProvider } from '@/context/AuthContext';
import { Slot } from 'expo-router';

/**
 * Root layout wraps everything with AuthProvider.
 * Does NOT include Stack or conditional logic — those go in children layouts.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <Slot />
    </AuthProvider>
  );
}
