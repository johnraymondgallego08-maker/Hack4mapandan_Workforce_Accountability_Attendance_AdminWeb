const util = require('util');
// Fix for [DEP0044]: The `util.isArray` API is deprecated.
if (util.isArray) util.isArray = Array.isArray;

const express = require("express");
const path = require("path");
const os = require("os");
require("dotenv").config();
// Initialize Firebase Admin SDK
const { admin, db, projectId, firebaseReady, initializationError } = require('./config/firebaseAdmin');
const expressLayouts = require("express-ejs-layouts");
const multer = require("multer");
const helmet = require("helmet");
const env = require('./config/env');

const webRoutes = require("./routes/web");
const adminRoutes = require("./routes/adminRoutes");
const overtimeRoutes = require("./routes/overtimeRoutes");
const userController = require("./controllers/userController");
const attendanceController = require("./controllers/attendanceControllers");
const payrollController = require("./controllers/payrollController");
const userModel = require("./models/userModel");
const authMiddleware = require("./middlewares/authMiddleware");
const adminMiddleware = require("./middlewares/adminMiddleware");
const securityMiddleware = require("./middlewares/securityMiddleware");
const { sessionMiddleware, flashMiddleware } = require("./middlewares/sessionMiddleware");

// Configure Multer for file uploads
const allowedUploadMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(os.tmpdir(), '4dmin-panel-uploads'))
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const mimeType = String(file.mimetype || '').toLowerCase();
        if (allowedUploadMimeTypes.includes(mimeType)) {
            return cb(null, true);
        }
        return cb(new Error('Only image uploads are allowed'));
    }
});

function runProfileUpload(req, res, next) {
    upload.single('profileImage')(req, res, (error) => {
        if (!error) {
            return next();
        }

        let message = error.message || 'Profile image upload failed.';
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            message = 'Profile image is too large. Maximum size is 5 MB.';
        }

        if (req.flash) {
            req.flash('error', message);
        }

        return res.redirect('/user-info');
    });
}

const app = express();
app.disable('x-powered-by');

function getOrigin(urlValue) {
    try {
        return new URL(urlValue).origin;
    } catch (error) {
        return null;
    }
}

function getMissingFirebaseConfig() {
    const missing = [];

    if (env.firebase.serviceAccount) {
        try {
            JSON.parse(env.firebase.serviceAccount);
        } catch (error) {
            missing.push('FIREBASE_SERVICE_ACCOUNT (invalid JSON)');
        }

        return missing;
    }

    if (!env.firebase.projectId) missing.push('FIREBASE_PROJECT_ID');
    if (!env.firebase.clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!env.firebase.privateKey && !env.firebase.privateKeyBase64 && !env.firebase.googleApplicationCredentials) {
        missing.push('FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64');
    }

    return missing;
}

if (env.isProduction) {
    app.set('trust proxy', 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

const firebaseAuthDomain = env.firebase.authDomain || ((env.firebase.projectId || projectId) ? `${env.firebase.projectId || projectId}.firebaseapp.com` : '');
const firebaseAuthOrigin = getOrigin(firebaseAuthDomain.startsWith('http') ? firebaseAuthDomain : `https://${firebaseAuthDomain}`);
const firebaseConnectSources = [
    "'self'",
    "ws://localhost:*",
    "wss://localhost:*",
    "https://unpkg.com",
    "https://cdn.jsdelivr.net",
    "https://www.gstatic.com",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://firestore.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://www.googleapis.com",
    "https://*.googleapis.com",
    "https://*.firebaseapp.com",
    "https://*.firebaseio.com",
    "https://*.firebasedatabase.app"
];

if (firebaseAuthOrigin && !firebaseConnectSources.includes(firebaseAuthOrigin)) {
    firebaseConnectSources.push(firebaseAuthOrigin);
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://www.gstatic.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: firebaseConnectSources,
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            frameSrc: ["'self'", "https://calendar.google.com", "https://www.google.com", "https://*.firebaseapp.com"],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(securityMiddleware.preventCaching);

app.use(sessionMiddleware);
app.use(flashMiddleware);
app.use(securityMiddleware.ensureCsrfToken);
app.use(securityMiddleware.verifyCsrfTokenUnlessMultipart);

app.use(async (req, res, next) => {
    let currentUser = req.session.user || null;

    if (req.session && req.session.user && req.session.user.uid) {
        try {
            const freshUser = await userModel.getUserById(req.session.user.uid);
            if (freshUser) {
                currentUser = {
                    ...req.session.user,
                    ...freshUser,
                    name: freshUser.name || req.session.user.name,
                    email: freshUser.email || req.session.user.email,
                    role: req.session.user.role || freshUser.role,
                    photoUrl: freshUser.photoUrl || freshUser.profileImage || req.session.user.photoUrl || null,
                    profileImage: freshUser.profileImage || freshUser.photoUrl || req.session.user.profileImage || null
                };
                req.session.user = currentUser;
            }
        } catch (error) {
            console.error('[APP] Failed to refresh sidebar admin profile:', error.message);
        }
    }

    res.locals.user = currentUser;
    res.locals.messages = req.flash();
    res.locals.firebaseConfig = {
        apiKey: env.firebase.apiKey,
        authDomain: env.firebase.authDomain || ((env.firebase.projectId || projectId) ? `${env.firebase.projectId || projectId}.firebaseapp.com` : null),
        projectId: env.firebase.projectId || projectId,
        storageBucket: env.firebase.storageBucket,
        messagingSenderId: env.firebase.messagingSenderId,
        appId: env.firebase.appId
    };
    res.locals.runtime = {
        isVercel: env.isVercel,
        realtimeProvider: 'firestore'
    };
    res.locals.firebaseStatus = {
        ready: firebaseReady,
        error: initializationError ? initializationError.message : '',
        missingConfig: getMissingFirebaseConfig()
    };
    res.locals.path = req.path;
    next();
});

app.use((req, res, next) => {
    if (firebaseReady) {
        return next();
    }

    const missingConfig = getMissingFirebaseConfig();
    const message = initializationError
        ? initializationError.message
        : 'Firebase Admin SDK is not configured.';
    const details = missingConfig.length
        ? `Missing or invalid environment variables: ${missingConfig.join(', ')}`
        : 'Check the Firebase Admin credentials configured for this deployment.';

    if (req.accepts('json') && !req.accepts('html')) {
        return res.status(503).json({
            error: 'Server configuration error',
            message,
            details
        });
    }

    return res.status(503).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Server Configuration Required</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f5f7fb; color: #1f2937; margin: 0; padding: 32px; }
                .card { max-width: 760px; margin: 40px auto; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
                h1 { margin-top: 0; font-size: 28px; }
                p { line-height: 1.6; }
                code { background: #eef2ff; padding: 2px 6px; border-radius: 6px; }
                .hint { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Firebase Admin configuration is required</h1>
                <p>${message}</p>
                <div class="hint">
                    <p><strong>What to set in Vercel:</strong></p>
                    <p>${details}</p>
                    <p>For Vercel, use <code>FIREBASE_SERVICE_ACCOUNT</code> or the split admin credentials:
                    <code>FIREBASE_PROJECT_ID</code>, <code>FIREBASE_CLIENT_EMAIL</code>, and <code>FIREBASE_PRIVATE_KEY</code>.</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post(
    '/update-profile',
    authMiddleware.isAuthenticated,
    runProfileUpload,
    securityMiddleware.verifyCsrfToken,
    userController.updateProfile
);

app.use("/", webRoutes);
app.use("/", adminRoutes);
app.use("/", overtimeRoutes);

// --- DATABASE SCANNER & DIAGNOSTICS ---
app.get('/db-status', authMiddleware.isAuthenticated, adminMiddleware.isAdmin, async (req, res) => {
    if (firebaseReady && admin.apps.length && db) {
        try {
            // Perform a quick scan of key collections
            const [adminCount, empCount, latestLog] = await Promise.all([
                db.collection('Admin').count().get(),
                db.collection('employees').count().get(),
                db.collection('attendance').orderBy('timestamp', 'desc').limit(1).get()
            ]);

            let statusMsg = `✅ Database connection stable. Project: ${projectId}<br>`;
            statusMsg += `📊 System Scan: ${adminCount.data().count} Admins | ${empCount.data().count} Employees<br>`;
            
            if (!latestLog.empty) {
                statusMsg += `🕒 Latest Security Log: ${latestLog.docs[0].data().employeeName} at ${latestLog.docs[0].data().timestamp.toDate().toLocaleString()}`;
            }

            res.status(200).send(`<html><body style="font-family:sans-serif; padding:20px;">${statusMsg}</body></html>`);
        } catch (error) {
            res.status(500).send(`❌ Database scan failed: ${error.message}`);
        }
    } else {
        res.status(500).send('❌ Server-side Firebase connection FAILED. Please check your service account credentials.');
    }
});

// --- EMERGENCY LOGIN FIX ROUTE ---
// Access this route in your browser: http://localhost:3000/fix-login
// It will reset/create the user 'admin@admin.com' with password 'admin123'
app.get('/fix-login', securityMiddleware.requireEmergencyAccess, async (req, res) => {
    const email = req.query.email || 'admin@admin.com';
    const password = req.query.password || 'admin123';
    try {
        let uid;
        try {
            const user = await admin.auth().getUserByEmail(email);
            uid = user.uid;
            await admin.auth().updateUser(uid, { password: password, disabled: false, emailVerified: true });
            console.log(`✅ [FIX] Password updated for ${email}`);
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                const user = await admin.auth().createUser({ email, password, displayName: 'System Admin', disabled: false });
                uid = user.uid;
                console.log(`✅ [FIX] Created new admin user ${email}`);
            } else throw e;
        }

        // Ensure admin privileges in Firestore
        const adminData = { 
            name: req.query.name || 'System Admin', 
            email: email, 
            role: 'admin',
            status: 'active', // Explicitly set to 'active' to pass status checks
            failedAttempts: 0 
        };
        await db.collection('Admin').doc(uid).set(adminData, { merge: true });
        await db.collection('employees').doc(uid).set({ ...adminData, status: 'Active' }, { merge: true });

        res.send(`<h1>Login Fixed</h1><p>You can now log in with:</p><ul><li>Email: <b>${email}</b></li><li>Password: <b>${password}</b></li></ul><br><a href="/">Go to Login</a>`);
    } catch (error) {
        console.error(error);
        res.status(500).send(`Error fixing login: ${error.message}`);
    }
});

module.exports = app;
