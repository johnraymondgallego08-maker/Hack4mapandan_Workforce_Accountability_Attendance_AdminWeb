const util = require('util');
// Fix for [DEP0044]: The `util.isArray` API is deprecated.
if (util.isArray) util.isArray = Array.isArray;

const express = require("express");
const path = require("path");
require("dotenv").config();
const http = require("http");
const socketio = require("socket.io");
// Initialize Firebase Admin SDK
const { admin, db, projectId } = require('./config/firebaseAdmin');
const RealtimeService = require('./services/realtimeService');
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");
const flash = require("connect-flash");
const multer = require("multer");
const helmet = require("helmet");

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

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

const app = express();
app.disable('x-powered-by');

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://www.gstatic.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "ws://localhost:*", "wss://localhost:*", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://firestore.googleapis.com", "https://www.googleapis.com", "https://*.googleapis.com"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
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

app.use(session({
    name: 'admin.sid',
    secret: process.env.SESSION_SECRET || 'secret-key', // Change this in production
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
}));

app.use(flash());
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
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : null),
        projectId: projectId, // Use the projectId from firebaseAdmin.js
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    };
    res.locals.path = req.path;
    next();
});

app.post(
    '/update-profile',
    authMiddleware.isAuthenticated,
    upload.single('profileImage'),
    userController.updateProfile
);

app.use("/", webRoutes);
app.use("/", adminRoutes);
app.use("/", overtimeRoutes);

// --- DATABASE SCANNER & DIAGNOSTICS ---
app.get('/db-status', authMiddleware.isAuthenticated, adminMiddleware.isAdmin, async (req, res) => {
    if (admin.apps.length) {
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

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_TRIES = 10;

let realtimeService = null;

function startServer(port, attemptsLeft = MAX_PORT_TRIES) {
    // Create HTTP server for Socket.io
    const server = http.createServer(app);
    
    // Initialize Socket.io
    const io = socketio(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket']
    });

    // Initialize real-time service
    realtimeService = new RealtimeService(io);
    realtimeService.initialize();

    server.listen(port, async () => {
        if (admin.apps.length) {
            console.log(`✅ Firebase Admin SDK initialized for project: ${projectId}`);
            try {
                await db.listCollections();
                console.log(`✅ Connected to database: ${projectId}`);
            } catch (error) {
                console.error('❌ Failed to connect to database:', error.message);
            }

            try {
                await admin.auth().listUsers(1);
                console.log(`✅ Connected to Authentication service.`);
            } catch (error) {
                console.error('❌ Failed to connect to Authentication service:', error.message);
            }
        }

        console.log(`✅ Server running on http://localhost:${port}`);
        console.log(`✅ Real-time updates enabled (Socket.io listening)`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`[APP] Port ${port} is already in use.`);
            // If PORT was explicitly provided via env, don't silently switch ports.
            if (process.env.PORT) {
                console.error('[APP] PORT is set in environment. Please stop the process using that port or set PORT to a different value.');
                process.exit(1);
            }

            if (attemptsLeft > 0) {
                const nextPort = port + 1;
                console.log(`[APP] Trying port ${nextPort} (${attemptsLeft - 1} attempts left)...`);
                setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
            } else {
                console.error('[APP] All fallback port attempts failed. Please free a port or set the PORT environment variable.');
                process.exit(1);
            }
        } else {
            console.error('[APP] Server error:', err);
            process.exit(1);
        }
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('[APP] Shutting down gracefully...');
        if (realtimeService) {
            realtimeService.cleanup();
        }
        server.close(() => {
            console.log('[APP] Server closed');
            process.exit(0);
        });
    });

    return server;
}

    startServer(DEFAULT_PORT);


module.exports = app;
