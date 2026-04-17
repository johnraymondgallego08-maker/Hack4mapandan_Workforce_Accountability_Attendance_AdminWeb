require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');

let projectId;

try {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Support for Vercel/Production: Loading from environment variable string
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Support for Local: Loading from file path
    const serviceAccountPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
    serviceAccount = require(serviceAccountPath);
  } else {
    throw new Error('Neither FIREBASE_SERVICE_ACCOUNT nor GOOGLE_APPLICATION_CREDENTIALS is set');
  }

  projectId = serviceAccount.project_id;

  admin.initializeApp({
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
