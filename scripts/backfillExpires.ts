import admin from 'firebase-admin';

const SERVICE_ACCOUNT = process.env.GOOGLE_APPLICATION_CREDENTIALS; // set to path of service account JSON or rely on ADC

if (!SERVICE_ACCOUNT) {
  console.warn('No GOOGLE_APPLICATION_CREDENTIALS set — ensure you have a service account or ADC configured.');
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function backfill(graceMinutes = 5, pageSize = 500) {
  let total = 0;
  while (true) {
    // Query docs where expiresAt is null (or missing)
    const q = db.collection('games')
      .where('expiresAt', '==', null)
      .limit(pageSize);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      const data = doc.data();
      const startISO = data.startISO ?? data.startDate ?? null;
      if (!startISO) continue;
      const startDate = new Date(startISO);
      if (isNaN(startDate.getTime())) continue;
      const expiresAt = admin.firestore.Timestamp.fromDate(new Date(startDate.getTime() + graceMinutes * 60 * 1000));
      batch.update(doc.ref, { expiresAt });
      total += 1;
    }
    await batch.commit();
    console.log(`Committed batch, total updated so far: ${total}`);
    if (snap.size < pageSize) break;
  }
  console.log('Backfill complete. total updated:', total);
}

backfill(5).catch((err) => {
  console.error('Backfill failed', err);
  process.exit(1);
});