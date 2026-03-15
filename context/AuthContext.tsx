import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
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
    const unsubscribe = auth().onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const ensureUserDoc = useCallback(
    async (u: FirebaseAuthTypes.User, extra?: Record<string, unknown>) => {
      try {
        const ref = firestore().collection('users').doc(u.uid);
        const snap = await ref.get();
        if (!snap.exists) {
          await ref.set({
            uid: u.uid,
            name: u.displayName ?? '',
            email: u.email ?? '',
            role: 'standard',
            teamId: null,
            isCoordinator: false,
            createdAt: firestore.FieldValue.serverTimestamp(),
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
    const { user: u } = await auth().signInWithEmailAndPassword(email, password);
    await ensureUserDoc(u);
  }, [ensureUserDoc]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: u } = await auth().createUserWithEmailAndPassword(email, password);
      await u.updateProfile({ displayName });
      await ensureUserDoc(u, { name: displayName });
    },
    [ensureUserDoc]
  );

  const signOut = useCallback(async () => {
    await auth().signOut();
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