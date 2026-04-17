/**
 * Real-Time Turbo Service
 * Implements high-performance broadcasting and payload optimization.
 */
const zlib = require('zlib');

class RealtimeTurboService {
    constructor(io) {
        this.io = io;
        this.compressionThreshold = 1024; // Compress if payload > 1KB
    }

    /**
     * High-speed broadcast with optional compression
     */
    fastBroadcast(room, event, data) {
        const payload = JSON.stringify(data);
        
        if (payload.length > this.compressionThreshold) {
            // Use Gzip for larger payloads to save bandwidth/latency
            zlib.gzip(payload, (err, buffer) => {
                if (!err) {
                    this.io.to(room).emit(`${event}:compressed`, buffer);
                } else {
                    this.io.to(room).emit(event, data);
                }
            });
        } else {
            // Direct emit for small payloads (faster)
            this.io.to(room).emit(event, data);
        }
    }

    /**
     * Priority Queue for critical updates (e.g., Auth, Security)
     */
    priorityBroadcast(room, event, data) {
        // socket.io 'volatile' flag bypasses some buffers for speed
        this.io.to(room).volatile.emit(event, {
            ...data,
            _ts: Date.now(), // High-resolution timestamp for sync
            _priority: 'high'
        });
    }

    handleError(error) {
        console.error(`[TURBO-ERROR] ${error.message}`);
    }
}

module.exports = RealtimeTurboService;