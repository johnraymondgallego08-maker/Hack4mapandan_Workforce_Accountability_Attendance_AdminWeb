/**
 * Real-Time Updates Handler for Attendance Monitor
 */
document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') {
        console.warn('[ATTENDANCE] Realtime client not available');
        return;
    }

    console.log('[ATTENDANCE] Initializing real-time handler...');
    realtime.joinRoom('attendance');

    const showNotification = (message, type = 'info') => {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: type.charAt(0).toUpperCase() + type.slice(1),
                text: message,
                icon: type,
                timer: 2000,
                position: 'top-end',
                showConfirmButton: false,
            });
        }
    };

    let reloadTimer = null;
    const scheduleRefresh = () => {
        window.clearTimeout(reloadTimer);
        reloadTimer = window.setTimeout(() => window.location.reload(), 1200);
    };

    realtime.on('attendance-updated', (data) => {
        console.log('[ATTENDANCE] Real-time update - record updated:', data);
        const row = document.querySelector(`#attendanceTable tbody tr[data-attendance-id="${data.id}"]`);
        if (row) {
            row.style.backgroundColor = data.changeType === 'removed'
                ? 'rgba(239, 68, 68, 0.1)'
                : 'rgba(59, 130, 246, 0.1)';
        }

        if (data.changeType === 'removed') {
            showNotification('An attendance record was removed. Refreshing list...', 'info');
        } else if (data.changeType === 'added') {
            showNotification('A new attendance record was added. Refreshing list...', 'info');
        } else {
            showNotification('An attendance record was updated. Refreshing list...', 'info');
        }

        scheduleRefresh();
    });
});
