// Type-safe Firebase helpers to avoid 'as any' throughout the codebase
import type { Firestore as WebFirestore } from 'firebase/firestore';

// Union type for native or web Firestore instance
export type FirestoreInstance = WebFirestore | NativeFirestore;

// Type for native @react-native-firebase Firestore (minimal shape we use)
export interface NativeFirestore {
  collection(path: string): NativeCollectionReference;
  enableNetwork(): Promise<void>;
}

export interface NativeCollectionReference {
  doc(id: string): NativeDocumentReference;
  add(data: any): Promise<NativeDocumentReference>;
  get(): Promise<NativeQuerySnapshot>;
}

export interface NativeDocumentReference {
  id: string;
  set(data: any, options?: { merge?: boolean }): Promise<void>;
  update(data: any): Promise<void>;
  delete(): Promise<void>;
  get(): Promise<NativeDocumentSnapshot>;
}

export interface NativeDocumentSnapshot {
  exists: boolean;
  id: string;
  data(): any;
}

export interface NativeQuerySnapshot {
  docs: NativeDocumentSnapshot[];
  forEach(callback: (doc: NativeDocumentSnapshot) => void): void;
}

// Type guard to check if it's a native Firestore instance
export function isNativeFirestore(db: any): db is NativeFirestore {
  return db && typeof db.collection === 'function';
}

// Type guard for auth instance
export function hasAuthMethods(auth: any): auth is {
  currentUser: any;
  signOut: () => Promise<void>;
  createUserWithEmailAndPassword: (email: string, password: string) => Promise<any>;
} {
  return auth && typeof auth.signOut === 'function';
}

/**
 * Runtime-safe add document to collection
 */
export async function addDocumentSafe(
  db: FirestoreInstance,
  collectionPath: string,
  data: Record<string, any>
): Promise<any> {
  if (isNativeFirestore(db)) {
    return db.collection(collectionPath).add(data);
  }

  const { collection, addDoc } = await import('firebase/firestore');
  return addDoc(collection(db as WebFirestore, collectionPath), data);
}

/**
 * Runtime-safe update document
 */
export async function updateDocumentSafe(
  db: FirestoreInstance,
  collectionId: string,
  docId: string,
  data: Record<string, any>
): Promise<void> {
  if (isNativeFirestore(db)) {
    return db.collection(collectionId).doc(docId).update(data);
  }

  const { doc, updateDoc } = await import('firebase/firestore');
  return updateDoc(doc(db as WebFirestore, collectionId, docId), data);
}

/**
 * Runtime-safe delete document
 */
export async function deleteDocumentSafe(
  db: FirestoreInstance,
  collectionId: string,
  docId: string
): Promise<void> {
  if (isNativeFirestore(db)) {
    return db.collection(collectionId).doc(docId).delete();
  }

  const { doc, deleteDoc } = await import('firebase/firestore');
  return deleteDoc(doc(db as WebFirestore, collectionId, docId));
}

/**
 * Runtime-safe set/upsert document with merge
 */
export async function setDocumentSafe(
  db: FirestoreInstance,
  collectionId: string,
  docId: string,
  data: Record<string, any>,
  options: { merge?: boolean } = {}
): Promise<void> {
  if (isNativeFirestore(db)) {
    return db.collection(collectionId).doc(docId).set(data, options);
  }

  const { doc, setDoc } = await import('firebase/firestore');
  return setDoc(doc(db as WebFirestore, collectionId, docId), data, options);
}

/**
 * Batch operations wrapper
 */
export async function executeBatchOperations(
  db: FirestoreInstance,
  operations: Array<{
    op: 'update' | 'delete';
    path: string; // format: "collection/docId"
    data?: Record<string, any>;
  }>
): Promise<void> {
  if (isNativeFirestore(db)) {
    // Native SDK doesn't have batch operations in the same way
    // Execute serially for now
    for (const operation of operations) {
      const [col, id] = operation.path.split('/');
      if (!col || !id) continue;

      if (operation.op === 'update' && operation.data) {
        await db.collection(col).doc(id).update(operation.data);
      } else if (operation.op === 'delete') {
        await db.collection(col).doc(id).delete();
      }
    }
    return;
  }

  const { writeBatch, doc } = await import('firebase/firestore');
  const batch = writeBatch(db as WebFirestore);

  for (const operation of operations) {
    const [col, id] = operation.path.split('/');
    if (!col || !id) continue;

    if (operation.op === 'update' && operation.data) {
      batch.update(doc(db as WebFirestore, col, id), operation.data);
    } else if (operation.op === 'delete') {
      batch.delete(doc(db as WebFirestore, col, id));
    }
  }

  await batch.commit();
}
