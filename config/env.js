require('dotenv').config();

function readString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value).trim();
}

function readBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const isVercel = readBoolean(process.env.VERCEL, false) || Boolean(readString(process.env.VERCEL));
const nodeEnv = readString(process.env.NODE_ENV, isVercel ? 'production' : 'development');
const isProduction = nodeEnv === 'production' || isVercel;

const env = {
    nodeEnv,
    isProduction,
    isVercel,
    port: parseInt(readString(process.env.PORT, '3000'), 10) || 3000,
    sessionSecret: readString(process.env.SESSION_SECRET, 'change-this-session-secret'),
    allowEmergencyAdminFix: readBoolean(process.env.ALLOW_EMERGENCY_ADMIN_FIX, false),
    allowDevDebug: readBoolean(process.env.ALLOW_DEV_DEBUG, false),
    debugPayrollMatch: readBoolean(process.env.DEBUG_PAYROLL_MATCH, false),
    firebase: {
        apiKey: readString(process.env.FIREBASE_API_KEY, ''),
        authDomain: readString(process.env.FIREBASE_AUTH_DOMAIN, ''),
        projectId: readString(process.env.FIREBASE_PROJECT_ID, ''),
        clientEmail: readString(process.env.FIREBASE_CLIENT_EMAIL, ''),
        privateKey: readString(process.env.FIREBASE_PRIVATE_KEY, ''),
        privateKeyBase64: readString(process.env.FIREBASE_PRIVATE_KEY_BASE64, ''),
        storageBucket: readString(process.env.FIREBASE_STORAGE_BUCKET, ''),
        messagingSenderId: readString(process.env.FIREBASE_MESSAGING_SENDER_ID, ''),
        appId: readString(process.env.FIREBASE_APP_ID, ''),
        serviceAccount: readString(process.env.FIREBASE_SERVICE_ACCOUNT, ''),
        googleApplicationCredentials: readString(process.env.GOOGLE_APPLICATION_CREDENTIALS, '')
    },
    supabase: {
        url: readString(process.env.SUPABASE_URL, ''),
        key: readString(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY, ''),
        bucket: readString(process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET, '')
    }
};

module.exports = env;
