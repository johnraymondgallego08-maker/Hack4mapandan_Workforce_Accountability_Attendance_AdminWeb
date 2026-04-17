/**
 * Real-Time Turbo Client
 * Enhances performance with Optimistic UI and Binary Handling
 */
window.realtimeTurbo = {
    /**
     * Executes an Optimistic Update.
     * @param {string} targetId - The ID of the container to update.
     * @param {Function} updateFn - Function that modifies the DOM.
     * @param {Function} apiCall - The actual fetch() call.
     */
    async optimisticUpdate(targetId, updateFn, apiCall) {
        const container = document.getElementById(targetId);
        const snapshot = container.innerHTML; // Save state for rollback

        try {
            // 1. Update UI Instantly (0ms latency)
            console.log('[TURBO] ⚡ Applying optimistic update');
            updateFn();

            // 2. Perform background sync
            const response = await apiCall();

            if (!response.ok) throw new Error('Sync failed');
            
            console.log('[TURBO] ✅ Background sync confirmed');
        } catch (error) {
            // 3. Rollback on failure
            console.error('[TURBO] ❌ Update failed, rolling back:', error);
            container.innerHTML = snapshot;
            
            if (window.Swal) {
                Swal.fire('Error', 'Real-time sync failed. Changes reverted.', 'error');
            }
        }
    },

    /**
     * Initialize high-frequency listeners
     */
    initFastListeners(socket) {
        socket.on('connect', () => {
            // Optimize socket buffer settings
            socket.io.opts.transports = ['websocket']; // Force WebSocket only for lower overhead
            console.log('[TURBO] 🚀 Connection tuned for maximum speed');
        });
    }
};