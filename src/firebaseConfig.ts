// firebaseConfig.ts
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';

// --- Your Firebase Web config ---
const firebaseConfig = {
  apiKey: "AIzaSyC0ZosmSPU1_KTd-eSAlZdCN2S_oSYQ3-Q",
  authDomain: "project-grace-475412.firebaseapp.com",
  projectId: "project-grace-475412",
  storageBucket: "project-grace-475412.appspot.com",
  messagingSenderId: "646265469239",
  appId: "1:646265469239:android:b0fa646716cd912deb02b2",
};

// ✅ Initialize only once
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ Use initializeAuth ONLY if not yet initialized
let auth;
try {
  auth = initializeAuth(app, { persistence: 'none' as any }); // 👈 force in-memory mode
} catch (e) {
  auth = getAuth(app);
}

// ✅ Firestore (Expo-safe)
let db;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch (e) {
  db = getFirestore(app);
}

export { app, auth, db };

