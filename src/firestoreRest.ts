// Lightweight Firestore REST helpers (reads). Attaches ID token when available.
import { auth, app as firebaseApp } from '@/firebaseConfig';

// Try global vars first (keeps previous behavior)
const GLOBAL_FIREBASE_CONFIG = (global as any).__FIREBASE_CONFIG__ || (global as any).firebaseConfig || (global as any).FIREBASE_CONFIG;

// Try to derive projectId/apiKey from multiple sources:
// 1) explicit global FIREBASE_CONFIG (keeps previous behavior)
// 2) environment variables (CI/local env)
// 3) firebase app options (initialized in src/firebaseConfig.ts)
const PROJECT_ID =
  GLOBAL_FIREBASE_CONFIG?.projectId ??
  (process.env.FIREBASE_PROJECT_ID as string | undefined) ??
  (firebaseApp && (firebaseApp as any).options?.projectId) ??
  undefined;

const API_KEY =
  GLOBAL_FIREBASE_CONFIG?.apiKey ??
  (process.env.FIREBASE_API_KEY as string | undefined) ??
  (firebaseApp && (firebaseApp as any).options?.apiKey) ??
  undefined;

if (!PROJECT_ID) {
  console.warn('Firestore REST helper: missing projectId in FIREBASE_CONFIG and app.options; REST reads will fail until a projectId is available.');
}

// Temporary diagnostic: log key values so we can verify env at runtime
console.log('[firestoreRest] PROJECT_ID=', PROJECT_ID, 'API_KEY present=', !!API_KEY, 'firebaseApp.options=', (firebaseApp as any)?.options ?? null);

async function getAuthToken(): Promise<string | null> {
  try {
    const a = auth as any;

    // If there is a currentUser, try to get a fresh id token first.
    const user = a?.currentUser ?? null;
    if (user) {
      // try forced refresh when available (helps if token expired or missing)
      if (typeof user.getIdToken === 'function') {
        try {
          const token = await user.getIdToken(true); // force refresh
          if (typeof token === 'string' && token.length) return token;
        } catch (e) {
          // fallback to non-forced getIdToken
          try {
            const token = await user.getIdToken();
            if (typeof token === 'string' && token.length) return token;
          } catch {
            // continue to other fallbacks
          }
        }
      }

      // Some native SDKs expose different helpers, try common alternatives
      if (typeof a.getIdToken === 'function') {
        try {
          const token = await a.getIdToken();
          if (typeof token === 'string' && token.length) return token;
        } catch {
          // ignore
        }
      }
    }

    // No user or couldn't fetch token
  } catch (e) {
    // ignore and return null below
  }
  return null;
}

function buildHeaders(withJson = true) {
  const headers: Record<string, string> = {};
  if (withJson) headers['Content-Type'] = 'application/json';
  return headers;
}

async function fetchWithAuth(url: string, opts: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = { ...(opts.headers ?? {}), ...(buildHeaders(opts.body != null)) } as Record<string, string>;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const urlWithKey = API_KEY ? (url.includes('?') ? `${url}&key=${API_KEY}` : `${url}?key=${API_KEY}`) : url;

  try {
    const res = await fetch(urlWithKey, { ...opts, headers });
    return res;
  } catch (err: any) {
    // Surface a clearer error for networking failures (e.g. no fetch, DNS, offline)
    const message = err?.message ?? String(err);
    throw new Error(`Network error when calling Firestore REST: ${message}`);
  }
}

/**
 * Get a single document by path "collection/doc[/subcollection/doc...]"
 * Returns parsed JS object or null if not found.
 */
export async function getDocument(path: string) {
  if (!PROJECT_ID) throw new Error('Missing PROJECT_ID for Firestore REST');

  // Attempt debug/verify auth, but do not let failures here block reads.
  let dbg: { currentUser: any; token: string | null; payload: any } | null = null;
  try {
    dbg = await debugAuthState('before getDocument ' + path);
  } catch (e) {
    console.warn('[firestoreRest] debugAuthState failed, continuing without debug info', e);
    dbg = { currentUser: null, token: null, payload: null };
  }

  // If reading a user doc, ensure token uid matches requested uid (rules require this)
  if (path.startsWith('users/')) {
    const requestedUid = path.split('/')[1];
    const tokenUid = dbg?.payload?.user_id ?? dbg?.payload?.uid;
    if (!tokenUid) {
      throw new Error('REST getDocument: no id token available (user not signed in) — rules require authentication');
    }
    if (tokenUid !== requestedUid) {
      throw new Error(`REST getDocument: token uid (${tokenUid}) does not match requested userId (${requestedUid}) — rules will deny this read`);
    }
  }

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetchWithAuth(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`REST getDocument failed ${res.status}: ${text}`);
  }
  const json = await res.json().catch(() => null);
  if (!json) return null;
  return parseDocumentJson(json);
}

function parseDocumentJson(docJson: any) {
  if (!docJson) return null;
  const fields = docJson.fields ?? {};
  const out: Record<string, any> = { id: docJson.name?.split('/').pop() ?? undefined };
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseValue(v as any);
  }
  return out;
}

function parseValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue) {
    const obj: Record<string, any> = {};
    const mapFields = v.mapValue.fields ?? {};
    for (const [k, vv] of Object.entries(mapFields)) obj[k] = parseValue(vv as any);
    return obj;
  }
  if (v.arrayValue) {
    const a = v.arrayValue.values ?? [];
    return a.map((item: any) => parseValue(item));
  }
  // timestampValue, geoPointValue, referenceValue etc. Return raw for now
  if (v.timestampValue) return v.timestampValue;
  if (v.geoPointValue) return { lat: Number(v.geoPointValue.latitude), lng: Number(v.geoPointValue.longitude) };
  if (v.referenceValue) return v.referenceValue;
  return v;
}

/**
 * Run a simple structuredQuery against a collection using runQuery
 * Accepts a small object for where/orderBy/limit and returns parsed documents array.
 */
export async function runCollectionQuery({
  collectionId,
  where = [],
  orderBy = [],
  limit,
}: {
  collectionId: string;
  where?: Array<{ fieldPath: string; op: string; value: any }>;
  orderBy?: Array<{ fieldPath: string; direction?: 'ASCENDING' | 'DESCENDING' }>;
  limit?: number;
}) {
  if (!PROJECT_ID) throw new Error('Missing PROJECT_ID for Firestore REST');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  // build structuredQuery
  const structured: any = {
    structuredQuery: {
      from: [{ collectionId }],
    },
  };
  if (where?.length) {
    structured.structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: where.map((w) => ({
          fieldFilter: {
            field: { fieldPath: w.fieldPath },
            op: w.op,
            value: encodeValue(w.value),
          },
        })),
      },
    };
  }
  if (orderBy?.length) {
    structured.structuredQuery.orderBy = orderBy.map((o) => ({
      field: { fieldPath: o.fieldPath },
      direction: o.direction || 'ASCENDING',
    }));
  }
  if (limit != null) structured.structuredQuery.limit = limit;

  const res = await fetchWithAuth(url, { method: 'POST', body: JSON.stringify(structured) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST runQuery failed ${res.status}: ${text}`);
  }
  const lines = (await res.text()).split('\n').filter(Boolean);
  const docs = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j.document) {
        docs.push(parseDocumentJson(j.document));
      }
    } catch {
      // ignore parse errors per-line
    }
  }
  return docs;
}

function encodeValue(v: any): any {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: `${v}` };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => encodeValue(x)) } };
  if (typeof v === 'object') {
    const fields: any = {};
    for (const key of Object.keys(v)) fields[key] = encodeValue(v[key]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// ---------- Debug helpers for firestoreRest.ts ----------

/**
 * Decode base64url-encoded string to UTF-8 string in a cross-platform way.
 * Uses globalThis.atob in browsers/RN if available, otherwise falls back to Buffer if present.
 */
function base64UrlDecodeToString(input: string): string | null {
  if (!input) return null;
  try {
    // Convert base64url -> base64
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);

    // Use atob if present (browser/React Native)
    if (typeof (globalThis as any).atob === 'function') {
      const binary = (globalThis as any).atob(base64);
      // convert binary string to UTF-8
      try {
        const percentEncoded = Array.prototype.map.call(binary, (c: string) => {
          const code = c.charCodeAt(0).toString(16).padStart(2, '0');
          return '%' + code;
        }).join('');
        return decodeURIComponent(percentEncoded);
      } catch {
        return binary;
      }
    }

    // Fallback to Buffer (Node-like env)
    if (typeof (globalThis as any).Buffer !== 'undefined') {
      // @ts-ignore - Buffer may exist in some RN setups or Node
      return (globalThis as any).Buffer.from(base64, 'base64').toString('utf8');
    }

    // Can't decode, return base64 string as last resort
    return base64;
  } catch (e) {
    return null;
  }
}

function decodeJwtPayload(token: string | null) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadStr = base64UrlDecodeToString(parts[1]);
    if (!payloadStr) return null;
    try {
      return JSON.parse(payloadStr);
    } catch {
      return null;
    }
  } catch (e) {
    return null;
  }
}

export async function debugAuthState(note = '') {
  try {
    const a = auth as any;
    console.log('[firestoreRest] debugAuthState', note, { currentUserExists: !!a?.currentUser });
    if (a?.currentUser) {
      // currentUser fields are small; avoid logging sensitive tokens in prod
      console.log('[firestoreRest] currentUser uid:', a.currentUser.uid ?? a.currentUser?.localId ?? '(no uid)');
      const tok = await (a.currentUser.getIdToken ? a.currentUser.getIdToken() : Promise.resolve(null));
      console.log('[firestoreRest] got idToken?', !!tok);
      const payload = decodeJwtPayload(tok);
      console.log('[firestoreRest] token payload (uid, exp):', payload ? { uid: payload?.user_id ?? payload?.uid, exp: payload?.exp } : null);
      return { currentUser: a.currentUser, token: tok, payload };
    }
    return { currentUser: null, token: null, payload: null };
  } catch (e) {
    console.warn('[firestoreRest] debugAuthState error', e);
    return { currentUser: null, token: null, payload: null };
  }
}

// Helpful convenience for querying "teams" list in earlier patches
export async function queryTeams({ limit = 50 } = {}) {
  return runCollectionQuery({ collectionId: 'teams', orderBy: [{ fieldPath: 'teamName' }], limit });
}

export default {
  getDocument,
  runCollectionQuery,
  queryTeams,
};