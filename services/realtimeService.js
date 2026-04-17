/**
 * Real-Time Updates Service using Socket.io
 * Handles live updates for events, attendances, leaves, payroll, etc.
 */

const { db } = require('../config/firebaseAdmin');
const RealtimeTurboService = require('../realtimeTurboService');

class RealtimeService {
    constructor(io) {
        this.io = io;
        this.turbo = new RealtimeTurboService(io);
        this.activeListeners = new Map();
    }

    /**
     * Initialize Socket.io event listeners
     */
    initialize() {
        console.log('[REALTIME] Initializing Socket.io listeners...');

        this.io.on('connection', (socket) => {
            console.log(`[SOCKET] ✅ Client connected: ${socket.id}`);

            // Join a room for real-time updates
            socket.on('join-events', () => {
                socket.join('events');
                console.log(`[SOCKET] Client joined 'events' room: ${socket.id}`);
            });

            socket.on('join-attendance', () => {
                socket.join('attendance');
                console.log(`[SOCKET] Client joined 'attendance' room: ${socket.id}`);
            });

            socket.on('join-leave', () => {
                socket.join('leave');
                console.log(`[SOCKET] Client joined 'leave' room: ${socket.id}`);
            });

            socket.on('join-payroll', () => {
                socket.join('payroll');
                console.log(`[SOCKET] Client joined 'payroll' room: ${socket.id}`);
            });

            socket.on('join-overtime', () => {
                socket.join('overtime');
                console.log(`[SOCKET] Client joined 'overtime' room: ${socket.id}`);
            });

            socket.on('disconnect', () => {
                console.log(`[SOCKET] ❌ Client disconnected: ${socket.id}`);
            });

            socket.on('error', (error) => {
                console.error(`[SOCKET] Error for ${socket.id}:`, error);
            });
        });

        // Setup Firebase listeners for real-time updates
        this.setupEventListeners();
        this.setupAttendanceListeners();
        this.setupLeaveListeners();
        this.setupPayrollListeners();
        this.setupOvertimeListeners();

        console.log('[REALTIME] ✅ All Firebase listeners initialized');
    }

    /**
     * Setup real-time listeners for events collection
     */
    setupEventListeners() {
        try {
            const unsubscribe = db.collection('events_announcements').onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const doc = change.doc;
                    const data = doc.data();

                    if (change.type === 'added') {
                        // Use priority broadcast for new content
                        this.turbo.priorityBroadcast('events', 'event-created', {
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt?.toDate?.() || new Date(),
                            eventDate: data.eventDate?.toDate?.() || null,
                        });
                        console.log(`[REALTIME] ✨ Event created: ${doc.id}`);
                    } else if (change.type === 'modified') {
                        this.turbo.fastBroadcast('events', 'event-updated', {
                            id: doc.id,
                            ...data,
                            updatedAt: data.updatedAt?.toDate?.() || new Date(),
                            eventDate: data.eventDate?.toDate?.() || null,
                        });
                        console.log(`[REALTIME] 📝 Event updated: ${doc.id}`);
                    } else if (change.type === 'removed') {
                        this.turbo.fastBroadcast('events', 'event-deleted', {
                            id: doc.id,
                        });
                        console.log(`[REALTIME] 🗑️ Event deleted: ${doc.id}`);
                    }
                });
            }, (error) => {
                console.error('[REALTIME] Error listening to events:', error.message);
            });

            this.activeListeners.set('events', unsubscribe);
        } catch (err) {
            console.error('[REALTIME] Failed to setup event listeners:', err.message);
        }
    }

    /**
     * Setup real-time listeners for attendance
     */
    setupAttendanceListeners() {
        try {
            const unsubscribe = db.collection('attendance').onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const doc = change.doc;
                    const data = doc.data();

                    if (change.type === 'added' || change.type === 'modified') {
                        this.turbo.fastBroadcast('attendance', 'attendance-updated', {
                            id: doc.id,
                            ...data,
                            timestamp: data.timestamp?.toDate?.() || new Date(),
                        });
                        console.log(`[REALTIME] 📊 Attendance ${change.type}: ${doc.id}`);
                    }
                });
            }, (error) => {
                console.error('[REALTIME] Error listening to attendance:', error.message);
            });

            this.activeListeners.set('attendance', unsubscribe);
        } catch (err) {
            console.error('[REALTIME] Failed to setup attendance listeners:', err.message);
        }
    }

    /**
     * Setup real-time listeners for leave requests
     */
    setupLeaveListeners() {
        try {
            const unsubscribe = db.collection('leaves').onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const doc = change.doc;
                    const data = doc.data();

                    if (change.type === 'added' || change.type === 'modified') {
                        this.turbo.fastBroadcast('leave', 'leave-updated', {
                            id: doc.id,
                            ...data,
                            leaveStartDate: data.leaveStartDate?.toDate?.() || null,
                            leaveEndDate: data.leaveEndDate?.toDate?.() || null,
                            createdAt: data.createdAt?.toDate?.() || new Date(),
                        });
                        console.log(`[REALTIME] 📅 Leave ${change.type}: ${doc.id}`);
                    }
                });
            }, (error) => {
                console.error('[REALTIME] Error listening to leaves:', error.message);
            });

            this.activeListeners.set('leave', unsubscribe);
        } catch (err) {
            console.error('[REALTIME] Failed to setup leave listeners:', err.message);
        }
    }

    /**
     * Setup real-time listeners for payroll
     */
    setupPayrollListeners() {
        try {
            const unsubscribe = db.collection('payroll').onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const doc = change.doc;
                    const data = doc.data();

                    if (change.type === 'added' || change.type === 'modified') {
                        this.turbo.fastBroadcast('payroll', 'payroll-updated', {
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt?.toDate?.() || new Date(),
                        });
                        console.log(`[REALTIME] 💰 Payroll ${change.type}: ${doc.id}`);
                    }
                });
            }, (error) => {
                console.error('[REALTIME] Error listening to payroll:', error.message);
            });

            this.activeListeners.set('payroll', unsubscribe);
        } catch (err) {
            console.error('[REALTIME] Failed to setup payroll listeners:', err.message);
        }
    }

    /**
     * Setup real-time listeners for overtime
     */
    setupOvertimeListeners() {
        try {
            const unsubscribe = db.collection('overtime').onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    const doc = change.doc;
                    const data = doc.data();

                    if (change.type === 'added' || change.type === 'modified') {
                        this.turbo.fastBroadcast('overtime', 'overtime-updated', {
                            id: doc.id,
                            ...data,
                            overtimeDate: data.overtimeDate?.toDate?.() || null,
                            createdAt: data.createdAt?.toDate?.() || new Date(),
                        });
                        console.log(`[REALTIME] ⏰ Overtime ${change.type}: ${doc.id}`);
                    }
                });
            }, (error) => {
                console.error('[REALTIME] Error listening to overtime:', error.message);
            });

            this.activeListeners.set('overtime', unsubscribe);
        } catch (err) {
            console.error('[REALTIME] Failed to setup overtime listeners:', err.message);
        }
    }

    /**
     * Broadcast custom event (can be used by controllers)
     */
    broadcastEvent(room, eventName, data) {
        this.io.to(room).emit(eventName, data);
    }

    /**
     * Cleanup all listeners (call on server shutdown)
     */
    cleanup() {
        this.activeListeners.forEach((unsubscribe) => {
            unsubscribe();
        });
        this.activeListeners.clear();
        console.log('[REALTIME] All listeners cleaned up');
    }
}

module.exports = RealtimeService;
