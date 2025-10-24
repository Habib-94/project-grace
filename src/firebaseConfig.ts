// Safe dual-mode firebase config: prefer native @react-native-firebase when available,
// fall back to the web modular SDK otherwise. Exports: app, auth, db, ensureFirestoreOnline.

import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth as getWebAuth } from 'firebase/auth';
import {
  getFirestore as getWebFirestore,
  initializeFirestore,
  enableNetwork as webEnableNetwork,
  Firestore as WebFirestore,
} from 'firebase/firestore';

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

// Exports expected by the rest of your codebase.
// We keep these names stable to avoid changing many imports.
let auth: any = null;
let db: any = null;

/**
 * Strategy:
 * 1) Try to load native @react-native-firebase packages (available only in a prebuilt/dev-client or native build).
 * 2) If native packages are not present, fall back to the web modular SDK (firebase/*).
 *
 * This keeps the project runnable on Expo Go (web SDK) and on a dev-client / built APK (native SDK).
 */
try {
  // Try native firebase (non-Expo-Go). Use require so Metro won't try to statically bundle these for Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rnApp = require('@react-native-firebase/app').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authNative = require('@react-native-firebase/auth').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const firestoreNative = require('@react-native-firebase/firestore').default;

  // If require succeeded, initialize / get native instances.
  // Note: these calls may throw if the native module isn't properly linked; catch will handle fallback.
  const nativeApp = rnApp(); // rarely needed but will error early if not configured
  auth = authNative(); // native auth instance
  db = firestoreNative(); // native firestore instance

  console.log('[firebaseConfig] Using native @react-native-firebase (auth + firestore)');
} catch (nativeErr) {
  // Fallback to web SDK
  try {
    auth = getWebAuth(app);

    // Try to initialize Firestore with long-polling to avoid streaming/webchannel issues on RN.
    try {
      // initializeFirestore may throw if already initialized (HMR), so guard with try/catch
      db = initializeFirestore(app, { experimentalForceLongPolling: true } as any);
    } catch (initErr) {
      db = getWebFirestore(app);
    }

    console.log('[firebaseConfig] Using web firebase SDK (auth + firestore)');
  } catch (webErr) {
    // Very defensive fallback — set to null and log.
    console.warn('[firebaseConfig] Failed to initialize firebase (native fallback and web fallback both failed).', {
      nativeErr,
      webErr,
    });
    auth = null;
    db = null;
  }
}

/**
 * ensureFirestoreOnline - works for both native and web Firestore objects.
 * - For web SDK: calls firebase.firestore.enableNetwork(db)
 * - For native @react-native-firebase: calls db().enableNetwork() if available
 */
export async function ensureFirestoreOnline(): Promise<void> {
  try {
    if (!db) return;

    // Native @react-native-firebase/firestore: instance is a function-like object where methods live on it
    if (typeof (db as any).enableNetwork === 'function') {
      // native: db().enableNetwork ? Some versions: db().enableNetwork()
      // But when we cached `db = firestoreNative()`, that is already the instance with methods.
      await (db as any).enableNetwork();
      await new Promise((r) => setTimeout(r, 50));
      console.log('[firebaseConfig] Firestore (native) network enabled');
      return;
    }

    // Web SDK: use enableNetwork exported helper
    if (typeof webEnableNetwork === 'function') {
      await webEnableNetwork(db as WebFirestore);
      await new Promise((r) => setTimeout(r, 50));
      console.log('[firebaseConfig] Firestore (web) network enabled');
      return;
    }

    console.warn('[firebaseConfig] ensureFirestoreOnline: unknown Firestore instance shape; no-op');
  } catch (err) {
    console.warn('[firebaseConfig] ensureFirestoreOnline error', err);
  }
}

// Export stable names used across the app.
// Use `any` here intentionally to avoid TypeScript type mismatches between web and native SDK types.
// If you migrate fully to native SDK, you can tighten types later.
export { app, auth, db };

