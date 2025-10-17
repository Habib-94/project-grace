// src/firebaseConfig.ts
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC0ZosmSPU1_KTd-eSAlZdCN2S_oSYQ3-Q",
  authDomain: "project-grace-475412.firebaseapp.com",
  projectId: "project-grace-475412",
  storageBucket: "project-grace-475412.appspot.com",
  messagingSenderId: "646265469239",
  appId: "1:646265469239:android:b0fa646716cd912deb02b2",
};

// ✅ initialize once only
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
