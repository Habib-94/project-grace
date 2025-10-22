import { auth } from '@/firebaseConfig';
import React, { createContext, useContext, useEffect, useState } from 'react';
// Import web onAuthStateChanged as a fallback (we'll only call it when needed)
import { onAuthStateChanged as webOnAuthStateChanged } from 'firebase/auth';

type AuthContextType = {
  user: any | null; // native user type (FirebaseAuth types differ)
  loading: boolean;
};

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      // No auth instance available; mark not loading to let app render
      setLoading(false);
      return;
    }

    // Subscribe using the shape available at runtime.
    // - Native @react-native-firebase: auth.onAuthStateChanged(callback) is a method.
    // - Web modular SDK: onAuthStateChanged(auth, callback) is a free function.
    let unsubscribe: (() => void) | undefined;

    try {
      if (typeof (auth as any).onAuthStateChanged === 'function') {
        // Native SDK style
        unsubscribe = (auth as any).onAuthStateChanged((nativeUser: any) => {
          setUser(nativeUser ?? null);
          setLoading(false);
          console.log('Auth state changed (native):', nativeUser ? 'logged in' : 'logged out');
        });
      } else {
        // Web modular SDK style
        unsubscribe = webOnAuthStateChanged(auth as any, (webUser) => {
          setUser(webUser ?? null);
          setLoading(false);
          console.log('Auth state changed (web):', webUser ? 'logged in' : 'logged out');
        });
      }
    } catch (err) {
      console.warn('[AuthContext] subscribe error', err);
      setLoading(false);
    }

    return () => {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch {
        /* ignore cleanup errors */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
