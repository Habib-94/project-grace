// src/firebaseConfig.ts
import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, initializeAuth } from 'firebase/auth';
import { enableNetwork, getFirestore } from 'firebase/firestore';

// ✅ Your Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyC0ZosmSPU1_KTd-eSAlZdCN2S_oSYQ3-Q',
  authDomain: 'project-grace-475412.firebaseapp.com',
  projectId: 'project-grace-475412',
  storageBucket: 'project-grace-475412.appspot.com',
  messagingSenderId: '646265469239',
  appId: '1:646265469239:android:b0fa646716cd912deb02b2',
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ Auth setup (browserLocalPersistence works for web + Expo Go)
const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

// ✅ Firestore setup with forced online mode
const db = getFirestore(app);

export async function ensureFirestoreOnline() {
  try {
    await enableNetwork(db);
    console.log('✅ Firestore forced online');
  } catch (err) {
    console.warn('⚠️ Firestore enableNetwork failed:', err);
  }
}

export { app, auth, db };

