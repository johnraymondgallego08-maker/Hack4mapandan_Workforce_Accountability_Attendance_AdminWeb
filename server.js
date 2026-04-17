const app = require('./app');
const http = require('http');
const socketio = require('socket.io');
const RealtimeService = require('./services/realtimeService');
const { admin, db, projectId } = require('./config/firebaseAdmin');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_TRIES = 10;

let realtimeService = null;

function startServer(port, attemptsLeft = MAX_PORT_TRIES) {
    const server = http.createServer(app);
    
    // Initialize Socket.io (Only for local/VPS development)
    const io = socketio(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket']
    });

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
            console.error(`[SERVER] Port ${port} is already in use.`);
            if (process.env.PORT) {
                process.exit(1);
            }

            if (attemptsLeft > 0) {
                const nextPort = port + 1;
                console.log(`[SERVER] Trying port ${nextPort} (${attemptsLeft - 1} attempts left)...`);
                setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
            } else {
                process.exit(1);
            }
        } else {
            console.error('[SERVER] Server error:', err);
            process.exit(1);
        }
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('[SERVER] Shutting down gracefully...');
        if (realtimeService) {
            realtimeService.cleanup();
        }
        server.close(() => {
            console.log('[SERVER] Server closed');
            process.exit(0);
        });
    });

    return server;
}

startServer(DEFAULT_PORT);