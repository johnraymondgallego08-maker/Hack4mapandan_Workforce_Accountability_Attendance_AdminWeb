/**
 * Socket.io Connection Diagnostic Tool
 * This script helps debug the real-time connection
 */

window.socketDiagnostics = {
    checkConnection: function() {
        console.log('\n=== SOCKET.IO DIAGNOSTICS ===\n');
        
        if (typeof io === 'undefined') {
            console.error('❌ Socket.io library NOT loaded');
            console.warn('Make sure <script src="/socket.io/socket.io.min.js"></script> is in main.ejs');
            return;
        }
        
        console.log('✅ Socket.io library loaded');
        
        if (typeof realtime === 'undefined') {
            console.error('❌ RealtimeClient NOT initialized');
            console.warn('Make sure <script src="/js/realtime.js"></script> is in main.ejs');
            return;
        }
        
        console.log('✅ RealtimeClient loaded');
        console.log(`Socket connected: ${window.realtime.isConnected}`);
        console.log(`Socket ID: ${window.realtime.socket?.id || 'Not connected'}`);
        console.log(`Listeners registered: ${window.realtime.listeners?.size || 0}`);
        
        // List all listeners
        if (window.realtime.listeners && window.realtime.listeners.size > 0) {
            console.log('\nRegistered event listeners:');
            window.realtime.listeners.forEach((callbacks, eventName) => {
                console.log(`  - ${eventName}: ${callbacks.length} listener(s)`);
            });
        }
    },

    testConnection: async function() {
        console.log('\n=== TESTING SOCKET.IO CONNECTION ===\n');
        
        if (!window.realtime) {
            console.error('❌ RealtimeClient not available');
            return;
        }

        // Wait for connection
        if (!window.realtime.isConnected) {
            console.log('⏳ Waiting for connection...');
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (window.realtime.isConnected) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => clearInterval(checkInterval), 5000);
            });
        }

        if (window.realtime.isConnected) {
            console.log('✅ Connected to Socket.io server');
            console.log(`Socket ID: ${window.realtime.socket.id}`);
        } else {
            console.error('❌ Failed to connect to Socket.io server');
            console.warn('Check that server is running and Firebase is configured');
        }
    },

    joinEventRoom: function() {
        console.log('\n=== JOINING EVENT ROOM ===\n');
        
        if (!window.realtime) {
            console.error('❌ RealtimeClient not available');
            return;
        }

        window.realtime.joinRoom('events');
        console.log('📡 Joined "events" room');

        // Register listener
        window.realtime.on('event-created', (data) => {
            console.log('🎉 EVENT RECEIVED:', data);
        });
        
        console.log('✅ Listener registered for event-created');
    }
};

// Auto-check on page load
window.addEventListener('load', () => {
    console.log('[DIAGNOSTICS] Running Socket.io diagnostics...\n');
    console.log('Run these commands in console to test:');
    console.log('  - socketDiagnostics.checkConnection()');
    console.log('  - socketDiagnostics.testConnection()');
    console.log('  - socketDiagnostics.joinEventRoom()');
    console.log('\n');
});
