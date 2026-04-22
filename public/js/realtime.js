/**
 * Client-side real-time adapter powered by Firestore listeners.
 * Works in local development and on Vercel using Firestore only.
 */

class RealtimeClient {
    constructor() {
        this.listeners = new Map();
        this.subscriptions = new Map();
        this.roomInitialised = new Set();
        this.isConnected = false;

        const currentPath = window.location.pathname;
        const segment = currentPath.split('/').filter(Boolean).pop();
        this.pageName = currentPath === '/'
            ? 'Dashboard'
            : (segment ? segment.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Admin');

        this.init();
    }

    init() {
        if (!window.db || typeof firebase === 'undefined' || !firebase.firestore) {
            console.warn('[REALTIME] Firestore is not available on this page.');
            return;
        }

        this.isConnected = true;
        console.log('[REALTIME] Firestore real-time listeners enabled for', this.pageName);
    }

    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);
    }

    triggerListener(eventName, data) {
        const callbacks = this.listeners.get(eventName) || [];
        callbacks.forEach((callback) => {
            try {
                callback(data);
            } catch (err) {
                console.error('[REALTIME] Listener error for', eventName, err);
            }
        });
    }

    joinRoom(room) {
        if (this.roomInitialised.has(room)) {
            return;
        }
        this.roomInitialised.add(room);
        this.attachFirestoreListeners(room);
    }

    attachFirestoreListeners(room) {
        const firestore = firebase.firestore();
        const register = (key, query, handler) => {
            const unsubscribe = query.onSnapshot((snapshot) => {
                const changes = snapshot.docChanges();
                if (!changes.length) return;
                if (!this.subscriptions.get(key)?.ready) {
                    this.subscriptions.set(key, { unsubscribe, ready: true });
                    return;
                }
                changes.forEach((change) => handler(change));
            }, (error) => {
                console.error('[REALTIME] Firestore listener error for', key, error);
            });
            this.subscriptions.set(key, { unsubscribe, ready: false });
        };

        if (room === 'events') {
            register('events', firestore.collection('events_announcements'), (change) => {
                const data = { id: change.doc.id, ...change.doc.data() };
                if (data.system) return;
                if (change.type === 'added') this.triggerListener('event-created', data);
                if (change.type === 'modified') this.triggerListener('event-updated', data);
                if (change.type === 'removed') this.triggerListener('event-deleted', data);
            });
            return;
        }

        if (room === 'attendance') {
            register('attendance', firestore.collection('attendance'), (change) => {
                this.triggerListener('attendance-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
            return;
        }

        if (room === 'leave') {
            register('leave', firestore.collectionGroup('leaves'), (change) => {
                this.triggerListener('leave-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
            return;
        }

        if (room === 'payroll') {
            register('payroll', firestore.collectionGroup('payroll'), (change) => {
                this.triggerListener('payroll-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
            return;
        }

        if (room === 'overtime') {
            register('overtime-main', firestore.collection('overtime'), (change) => {
                this.triggerListener('overtime-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
            register('overtime-attendance', firestore.collection('attendance'), (change) => {
                const data = change.doc.data() || {};
                const isRequested = data.isOTRequested === true || String(data.isOTRequested).toLowerCase() === 'true' || data.otStatus;
                if (!isRequested) return;
                this.triggerListener('overtime-updated', { id: change.doc.id, ...data, changeType: change.type });
            });
            return;
        }

        if (room === 'users') {
            register('users-employees', firestore.collection('employees'), (change) => {
                this.triggerListener('user-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
            register('users-admin', firestore.collection('Admin'), (change) => {
                this.triggerListener('user-updated', { id: change.doc.id, ...change.doc.data(), changeType: change.type });
            });
        }
    }

    disconnect() {
        this.subscriptions.forEach((entry) => {
            if (entry && typeof entry.unsubscribe === 'function') {
                entry.unsubscribe();
            }
        });
        this.subscriptions.clear();
    }
}

window.realtime = new RealtimeClient();
