import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
    createUserWithEmailAndPassword,
    getAuth,
    onAuthStateChanged,
    signOut as rnfSignOut,
    signInWithEmailAndPassword,
} from '@react-native-firebase/auth';
import {
    doc,
    getDoc,
    getFirestore,
    serverTimestamp,
    setDoc,
} from '@react-native-firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: FirebaseAuthTypes.User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(), (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const ensureUserDoc = useCallback(
    async (u: FirebaseAuthTypes.User, extra?: Record<string, unknown>) => {
      try {
        const db = getFirestore();
        const ref = doc(db, 'users', u.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            uid: u.uid,
            name: u.displayName ?? '',
            email: u.email ?? '',
            role: 'standard',
            teamId: null,
            isCoordinator: false,
            createdAt: serverTimestamp(),
            ...extra,
          });
        }
      } catch (e) {
        console.warn('[AuthContext] ensureUserDoc failed', e);
      }
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: u } = await signInWithEmailAndPassword(getAuth(), email, password);
    await ensureUserDoc(u);
  }, [ensureUserDoc]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: u } = await createUserWithEmailAndPassword(getAuth(), email, password);
      await u.updateProfile({ displayName });
      await ensureUserDoc(u, { name: displayName });
    },
    [ensureUserDoc]
  );

  const signOut = useCallback(async () => {
    await rnfSignOut(getAuth());
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default AuthContext;