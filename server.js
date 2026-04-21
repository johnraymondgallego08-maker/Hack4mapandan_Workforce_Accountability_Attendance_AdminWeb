const app = require('./app');
const { admin, db, projectId } = require('./config/firebaseAdmin');
const env = require('./config/env');

const DEFAULT_PORT = env.port || 3000;
const MAX_PORT_TRIES = 10;

function startServer(port, attemptsLeft = MAX_PORT_TRIES) {
    const listener = app.listen(port, async () => {
        if (admin.apps.length) {
            console.log('Firebase Admin SDK initialized for project:', projectId);
            try {
                await db.listCollections();
                console.log('Connected to database:', projectId);
            } catch (error) {
                console.error('Failed to connect to database:', error.message);
            }

            try {
                await admin.auth().listUsers(1);
                console.log('Connected to Authentication service.');
            } catch (error) {
                console.error('Failed to connect to Authentication service:', error.message);
            }
        }

        console.log('Server running on http://localhost:' + port);
        console.log('Real-time updates enabled via Firestore listeners');
    });

    listener.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error('[SERVER] Port ' + port + ' is already in use.');
            if (process.env.PORT) {
                process.exit(1);
            }

            if (attemptsLeft > 0) {
                const nextPort = port + 1;
                console.log('[SERVER] Trying port ' + nextPort + ' (' + (attemptsLeft - 1) + ' attempts left)...');
                setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
            } else {
                process.exit(1);
            }
        } else {
            console.error('[SERVER] Server error:', err);
            process.exit(1);
        }
    });

    process.on('SIGINT', () => {
        console.log('[SERVER] Shutting down gracefully...');
        listener.close(() => {
            console.log('[SERVER] Server closed');
            process.exit(0);
        });
    });

    return listener;
}

startServer(DEFAULT_PORT);
