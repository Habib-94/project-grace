// src/firebaseConfig.ts
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { enableNetwork, Firestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC0ZosmSPU1_KTd-eSAlZdCN2S_oSYQ3-Q',
  authDomain: 'project-grace-475412.firebaseapp.com',
  projectId: 'project-grace-475412',
  storageBucket: 'project-grace-475412.appspot.com',
  messagingSenderId: '646265469239',
  appId: '1:646265469239:android:b0fa646716cd912deb02b2',
};

// Ensure single app instance across HMR / Fast Refresh
let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

// Use simple getAuth for Expo Go (memory persistence). Switch to initializeAuth + AsyncStorage only in custom dev client.
const auth: Auth = getAuth(app);

// Single Firestore instance
const db: Firestore = getFirestore(app);

// Safe enable network helper (defensive)
export async function ensureFirestoreOnline(): Promise<void> {
  try {
    if (!db) return;
    await enableNetwork(db);
    // small delay to let SDK settle after switching network
    await new Promise((r) => setTimeout(r, 50));
    console.log('Firestore network enabled');
  } catch (err) {
    console.warn('ensureFirestoreOnline error', err);
  }
}

export { app, auth, db };

