/**
 * Real-Time Updates Handler for Overtime Page
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') return;

    realtime.joinRoom('overtime');

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

    realtime.on('overtime-updated', (data) => {
        console.log('[OVERTIME] Updated:', data);
        
        const tbody = document.querySelector('table tbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            if (rows.length > 0) {
                rows[0].style.backgroundColor = 'rgba(156, 39, 176, 0.1)';
                setTimeout(() => {
                    rows[0].style.backgroundColor = '';
                }, 1500);
            }
        }

        showNotification('Overtime request updated in real-time', 'info');
    });

    console.log('[OVERTIME] Real-time listeners initialized');
});
