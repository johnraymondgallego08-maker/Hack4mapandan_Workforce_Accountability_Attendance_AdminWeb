/**
 * Client-Side Real-Time Socket.io Handler
 * Include this script in views that need real-time updates
 * Usage: <script src="/js/realtime.js"></script>
 */

class RealtimeClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.messageQueue = [];
        this.listeners = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.init();
    }

    init() {
        if (typeof io === 'undefined') {
            console.warn('[REALTIME] ❌ Socket.io library not loaded');
            return;
        }

        console.log('[REALTIME] 🔌 Initializing Socket.io connection...');

        this.socket = io({
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: this.maxReconnectAttempts,
            transports: ['websocket']
        });

        // Initialize Real-Time Turbo client-side optimizations
        if (window.realtimeTurbo && typeof window.realtimeTurbo.initFastListeners === 'function') {
            window.realtimeTurbo.initFastListeners(this.socket);
        }

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('[REALTIME] ✅ Connected to server');
            console.log(`[REALTIME] Socket ID: ${this.socket.id}`);
            this.processQueue();
            this.onConnect?.();
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            console.log('[REALTIME] ❌ Disconnected from server');
            this.onDisconnect?.();
        });

        this.socket.on('connect_error', (error) => {
            console.error('[REALTIME] 🔴 Connection error:', error);
            this.reconnectAttempts++;
        });

        this.socket.on('reconnect_attempt', () => {
            console.log(`[REALTIME] 🔄 Reconnection attempt ${this.reconnectAttempts}...`);
        });

        // Event listeners
        this.socket.on('event-created', (data) => this.triggerListener('event-created', data));
        this.socket.on('event-updated', (data) => this.triggerListener('event-updated', data));
        this.socket.on('event-deleted', (data) => this.triggerListener('event-deleted', data));

        // Attendance listeners
        this.socket.on('attendance-updated', (data) => this.triggerListener('attendance-updated', data));

        // Leave listeners
        this.socket.on('leave-updated', (data) => this.triggerListener('leave-updated', data));

        // Payroll listeners
        this.socket.on('payroll-updated', (data) => this.triggerListener('payroll-updated', data));

        // Overtime listeners
        this.socket.on('overtime-updated', (data) => this.triggerListener('overtime-updated', data));
    }

    /**
     * Subscribe to a real-time update event
     */
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);
        console.log(`[REALTIME] 📡 Listener registered for: ${eventName}`);
    }

    /**
     * Trigger all listeners for an event
     */
    triggerListener(eventName, data) {
        const callbacks = this.listeners.get(eventName) || [];
        console.log(`[REALTIME] 📢 Triggering ${callbacks.length} listeners for: ${eventName}`);
        callbacks.forEach((callback) => {
            try {
                callback(data);
            } catch (err) {
                console.error(`[REALTIME] ⚠️ Error in listener for ${eventName}:`, err);
            }
        });
    }

    /**
     * Join a room for real-time updates
     */
    joinRoom(room) {
        console.log(`[REALTIME] 🚪 Joining room: ${room}`);
        if (this.isConnected) {
            this.socket.emit(`join-${room}`);
        } else {
            console.log(`[REALTIME] ⏳ Queuing join-${room} (waiting for connection)`);
            this.messageQueue.push(() => this.socket.emit(`join-${room}`));
        }
    }

    /**
     * Process queued messages after connection
     */
    processQueue() {
        console.log(`[REALTIME] 📤 Processing ${this.messageQueue.length} queued messages`);
        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            msg();
        }
    }

    /**
     * Disconnect from the server
     */
    disconnect() {
        if (this.socket) {
            console.log('[REALTIME] 🔌 Disconnecting from server');
            this.socket.disconnect();
        }
    }
}

// Global instance
window.realtime = new RealtimeClient();
console.log('[REALTIME] ✨ RealtimeClient initialized');
