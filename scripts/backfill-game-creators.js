// scripts/backfill-game-creators.js
const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

async function run() {
  const gamesSnap = await db.collection('games').get();
  console.log('Found games:', gamesSnap.size);

  for (const doc of gamesSnap.docs) {
    const data = doc.data();
    const createdBy = data.createdBy;
    if (!createdBy) {
      console.log('Skipping', doc.id, 'no createdBy');
      continue;
    }

    // If already denormalized (name and rating present), skip
    if (data.createdByName && typeof data.createdByRating !== 'undefined') {
      console.log('Already has name+rating', doc.id);
      continue;
    }

    // read user profile (admin has access)
    const userDoc = await db.collection('users').doc(String(createdBy)).get();
    if (!userDoc.exists) {
      console.log('No user doc for', createdBy, 'skipping', doc.id);
      continue;
    }

    const user = userDoc.data() || {};
    const update = {
      createdByName: user.displayName || user.name || '',
      createdByEmail: user.email || '',
      createdByRating: typeof user.rating !== 'undefined' ? user.rating : null,
    };

    await db.collection('games').doc(doc.id).update(update);
    console.log('Backfilled', doc.id, update);
  }
  console.log('Done');
}

run().catch((err) => {
  console.error('Backfill failed', err);
  process.exit(1);
});