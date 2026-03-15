import firebase from 'firebase/app';
import 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const projectId = 'your-project-id';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

export const firestore = testEnv.unauthenticatedContext().firestore();