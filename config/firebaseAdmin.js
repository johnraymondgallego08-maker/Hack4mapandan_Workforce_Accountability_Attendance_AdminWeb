require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');

let projectId;

try {
  // This will automatically use the GOOGLE_APPLICATION_CREDENTIALS environment
  // variable set in your .env file to find the service account key.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');
  }

  const serviceAccountPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const serviceAccount = require(serviceAccountPath);
  projectId = serviceAccount.project_id;

  admin.initializeApp({
    // Use the loaded service account cert directly
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${projectId}.firebaseio.com`,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
  });
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error.message);
  console.error('Please ensure GOOGLE_APPLICATION_CREDENTIALS is set correctly in your .env file and points to a valid service account key file.');
  process.exit(1);
}

const db = admin.firestore();

module.exports = { admin, db, projectId };
