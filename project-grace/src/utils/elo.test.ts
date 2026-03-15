const firebase = require('@firebase/testing');
const assert = require('assert');

const projectId = "your-project-id"; // Replace with your actual project ID
const app = firebase.initializeTestApp({ projectId });
const db = app.firestore();

beforeEach(async () => {
    await firebase.clearFirestoreData({ projectId });
});

test('hello world!', async () => {
    const docRef = db.collection('testCollection').doc('testDoc');
    await docRef.set({ message: 'Hello, world!' });
    
    const doc = await docRef.get();
    assert.strictEqual(doc.data().message, 'Hello, world!');
});