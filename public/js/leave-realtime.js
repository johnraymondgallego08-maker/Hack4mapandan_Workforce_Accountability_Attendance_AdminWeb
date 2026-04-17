/**
 * Real-Time Updates Handler for Manage Leave Page
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') return;

    realtime.joinRoom('leave');

    const showNotification = (message, type = 'info') => {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: type.charAt(0).toUpperCase() + type.slice(1),
                text: message,
                icon: type,
                timer: 3000,
                position: 'top-end',
                showConfirmButton: false,
            });
        }
    };

    realtime.on('leave-updated', (data) => {
        console.log('[LEAVE] Updated:', data);
        // Reload the leave requests table
        const tbody = document.querySelector('table tbody');
        if (tbody) {
            // Flash existing rows to show data changed
            const rows = tbody.querySelectorAll('tr');
            if (rows.length > 0) {
                rows[0].style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
                setTimeout(() => {
                    rows[0].style.backgroundColor = '';
                }, 2000);
            }
        }
        showNotification('Leave request updated', 'info');
    });

    console.log('[LEAVE] Real-time listeners initialized');
});
