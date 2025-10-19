// src/firebaseConfig.ts
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  initializeAuth
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ✅ Your Firebase configuration (replace with your real keys)
const firebaseConfig = {
  apiKey: "AIzaSyC0ZosmSPU1_KTd-eSAlZdCN2S_oSYQ3-Q",
  authDomain: "project-grace-475412.firebaseapp.com",
  projectId: "project-grace-475412",
  storageBucket: "project-grace-475412.appspot.com",
  messagingSenderId: "646265469239",
  appId: "1:646265469239:android:b0fa646716cd912deb02b2",
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ Initialize Auth
// For Expo, we use browserLocalPersistence — works on Web, iOS, and Android in Expo Go.
const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
});

// ✅ Initialize Firestore
const db = getFirestore(app);

// ✅ Export properly typed instances
export { app, auth, db };

