const admin = require('firebase-admin');
const path = require('path');
const env = require('./env');

let projectId;

try {
  let serviceAccount;

  if (env.firebase.serviceAccount) {
    // Support for Vercel/Production: Loading from environment variable string
    serviceAccount = JSON.parse(env.firebase.serviceAccount);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else if (env.firebase.googleApplicationCredentials) {
    // Support for Local: Loading from file path
    const serviceAccountPath = path.resolve(process.cwd(), env.firebase.googleApplicationCredentials);
    serviceAccount = require(serviceAccountPath);
  } else {
    throw new Error('Neither FIREBASE_SERVICE_ACCOUNT nor GOOGLE_APPLICATION_CREDENTIALS is set');
  }

  projectId = serviceAccount.project_id;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${projectId}.firebaseio.com`,
    storageBucket: env.firebase.storageBucket || undefined
  });
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error.message);
  console.error('Please ensure FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS is configured correctly.');
  process.exit(1);
}

const db = admin.firestore();

module.exports = { admin, db, projectId };
