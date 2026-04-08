const { admin, db } = require('../config/firebaseAdmin');
const securityMiddleware = require('../middlewares/securityMiddleware');

exports.loginPage = (req, res) => {
    // If user is already logged in, redirect to dashboard
    if (req.session.user) {
        return res.redirect('/');
    }
    // Pass firebaseConfig to the login page so the project name is available
    res.render('login', { firebaseConfig: res.locals.firebaseConfig });
};

exports.registerPage = (req, res) => {
    res.render('register', {
        title: 'Register New User'
    });
};

exports.login = async (req, res) => {
    try {
        // Aggressively extract device info from the request body (handling both camelCase and snake_case)
        const { idToken, deviceId, device_id, deviceName, device_name, deviceUsed, device_used, deviceUsage, hardwareSerial, serialCode } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'ID token is required.' });
        }

        console.log('[AUTH] Verifying ID token...');
        const decodedToken = await admin.auth().verifyIdToken(idToken, true); // Check for revoked/disabled status
        const uid = decodedToken.uid;
        const email = decodedToken.email;

        console.log(`[AUTH] Token verified for UID: ${uid}`);

        // Check if the user is disabled in Firebase Authentication directly
        const authUser = await admin.auth().getUser(uid);
        if (authUser.disabled) {
            return res.status(403).json({ error: 'This account has been disabled in the authentication system.' });
        }

        // 1. Fetch both records. We use these for role and status checks.
        const [empDoc, adminDoc] = await Promise.all([
            db.collection('employees').doc(uid).get(),
            db.collection('Admin').doc(uid).get()
        ]);

        const empData = empDoc.data() || {};
        const adminData = adminDoc.data() || {};

        const displayName = adminData.name || empData.name || decodedToken.name || email.split('@')[0];

        // 2. Security Scan: Ensure the account is not suspended or inactive
        const accountStatus = (adminData.status || empData.status || 'Active').toLowerCase();
        if (['suspended', 'inactive', 'blocked'].includes(accountStatus)) {
            console.log(`[AUTH] Login blocked for ${email}. Status: ${accountStatus}`);
            return res.status(403).json({ error: `Your account is ${accountStatus}. Please contact support.` });
        }

        // 3. Device Monitoring: Record session for EMPLOYEES ONLY
        if (!adminDoc.exists) {
            const brandName = deviceName || device_name || 'Mobile Device';
            const deviceCode = deviceUsage || deviceUsed || device_used || hardwareSerial || serialCode || deviceId || device_id || 'Unknown Code';

            // Using .add() ensures a NEW record is created every time instead of updating
            await db.collection('attendance').add({
                coords: {
                    employeeId: uid,
                    employeeName: displayName,
                    deviceUsed: deviceCode,
                    deviceUsage: deviceCode
                },
                timestamp: admin.firestore.Timestamp.now(), // New time for every login
                type: 'Security Check',
                deviceName: brandName,
                deviceSerial: deviceCode,
                deviceUsed: deviceCode,
                deviceUsage: deviceCode
            });
            console.log(`[AUTH] 🛡️ Security log added for employee: ${displayName}`);
        }

        // 4. Role Gating: Handle Mobile App (Employee) vs Admin Panel (Web)
        if (!adminDoc.exists) {
            // Allow login if user is an employee. Log is already added above.
            if (empDoc.exists) {
                console.log(`[AUTH] Mobile app login successful for employee: ${email}`);
                return res.status(200).json({ message: 'Login successful' });
            }
            console.log(`[AUTH] Access denied for ${email}. UID ${uid} not found in Admin collection.`);
            return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
        }

        console.log(`[AUTH] Admin role from Firestore: "${adminData.role}"`);
        const now = Date.now();

        // 5. Brute Force Protection: Check if account is locked (Web Admin Only)
        if (adminData.lockUntil && adminData.lockUntil.toMillis() > now) {
            const waitTime = Math.ceil((adminData.lockUntil.toMillis() - now) / (60 * 1000));
            return res.status(403).json({
                error: `Too many failed attempts. Please wait ${waitTime} minute(s).`,
                isLocked: true
            });
        }

        // 3. Verify Admin Role
        const userRole = (adminData.role || '').toLowerCase();
        if (userRole !== 'admin') {
            const failedAttempts = (adminData.failedAttempts || 0) + 1;
            const updateData = { failedAttempts };
            
            if (failedAttempts >= 10) updateData.status = 'blocked';
            else if (failedAttempts === 5) updateData.lockUntil = admin.firestore.Timestamp.fromMillis(now + 10 * 60 * 1000);

            await db.collection('Admin').doc(uid).update(updateData);
            return res.status(403).json({ error: 'Access denied. Administrator role required.' });
        }

        // Reset failure counters on successful login
        await db.collection('Admin').doc(uid).update({
            failedAttempts: 0,
            lockUntil: null
        });

        const sessionUser = {
            uid: uid,
            email: email,
            name: displayName,
            role: 'Admin'
        };

        req.session.regenerate((sessionError) => {
            if (sessionError) {
                console.error('[AUTH] Session regenerate error:', sessionError);
                return res.status(500).json({ error: 'Failed to create a secure session.' });
            }

            req.session.user = sessionUser;
            req.session.csrfToken = securityMiddleware.generateCsrfToken();

            // Explicitly save the session before sending response to ensure redirect works
            req.session.save((err) => {
                if (err) {
                    console.error('[AUTH] Session save error:', err);
                    return res.status(500).json({ error: 'Failed to initialize session.' });
                }

                securityMiddleware.clearLoginRateLimit(req);
                console.log(`[AUTH] Admin login successful for ${email}.`);
                res.status(200).json({ message: 'Login successful', csrfToken: req.session.csrfToken });
            });
        });

    } catch (error) {
        console.error('[AUTH] An unexpected error occurred during login:', error);
        res.status(500).json({ error: 'An internal error occurred. Please try again later.' });
    }
};

exports.register = async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        req.flash('error', 'Please fill out all fields.');
        return res.redirect('/register');
    }

    try {
        // 1. Create user in Firebase Authentication
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            displayName: name,
        });

        const normalizedRole = role.trim();

        // 2. Save user details to 'employees' collection in Firestore, using the UID from Auth as the document ID
        await db.collection('employees').doc(userRecord.uid).set({
            name: name,
            email: email,
            role: normalizedRole,
            status: 'Active', // Default status
            employmentStatus: '',
            workSchedule: '',
            supervisor: ''
        });

        // 3. If role is admin, also add to 'Admin' collection to allow login access
        if (normalizedRole.toLowerCase() === 'admin') {
            await db.collection('Admin').doc(userRecord.uid).set({
                name: name,
                email: email,
                role: 'admin',
                status: 'active',
                failedAttempts: 0,
                lockUntil: null
            });
        }

        req.flash('success', `User "${name}" created successfully.`);
        res.redirect('/manage-users');
    } catch (error) {
        console.error('[REGISTER] Error creating new user:', error);
        req.flash('error', error.message);
        res.redirect('/register');
    }
};
