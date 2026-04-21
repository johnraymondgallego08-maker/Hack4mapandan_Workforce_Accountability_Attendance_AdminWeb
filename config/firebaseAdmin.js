const admin = require('firebase-admin');
const path = require('path');
const env = require('./env');

let projectId;
let initializationError = null;

function normalizePrivateKey(value = '') {
  if (!value) return '';
  return String(value).replace(/\\n/g, '\n');
}

function buildServiceAccountFromEnv() {
  const directPrivateKey = normalizePrivateKey(env.firebase.privateKey);
  let decodedPrivateKey = '';

  if (!directPrivateKey && env.firebase.privateKeyBase64) {
    try {
      decodedPrivateKey = Buffer.from(env.firebase.privateKeyBase64, 'base64').toString('utf8');
    } catch (error) {
      throw new Error('FIREBASE_PRIVATE_KEY_BASE64 is not valid base64');
    }
  }

  const privateKey = normalizePrivateKey(directPrivateKey || decodedPrivateKey);
  const candidateProjectId = env.firebase.projectId;
  const clientEmail = env.firebase.clientEmail;

  if (!candidateProjectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: candidateProjectId,
    client_email: clientEmail,
    private_key: privateKey
  };
}

try {
  let serviceAccount;

  if (env.firebase.serviceAccount) {
    // Support for Vercel/Production: Loading from environment variable string
    serviceAccount = JSON.parse(env.firebase.serviceAccount);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else if (buildServiceAccountFromEnv()) {
    serviceAccount = buildServiceAccountFromEnv();
  } else if (env.firebase.googleApplicationCredentials) {
    // Support for Local: Loading from file path
    const serviceAccountPath = path.resolve(process.cwd(), env.firebase.googleApplicationCredentials);
    serviceAccount = require(serviceAccountPath);
  } else {
    throw new Error('Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.');
  }

  projectId = serviceAccount.project_id;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${projectId}.firebaseio.com`,
    storageBucket: env.firebase.storageBucket || undefined
  });
} catch (error) {
  initializationError = error;
  console.error('Firebase Admin SDK initialization error:', error.message);
  console.error('Please ensure FIREBASE_SERVICE_ACCOUNT or the split FIREBASE_* credential variables are configured correctly.');
  throw error;
}

const db = admin.firestore();

module.exports = { admin, db, projectId, initializationError };
