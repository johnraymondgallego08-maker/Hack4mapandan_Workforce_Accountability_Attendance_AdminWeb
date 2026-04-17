/**
 * Real-Time Updates Handler for Payroll Page
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') return;

    realtime.joinRoom('payroll');

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

    realtime.on('payroll-updated', (data) => {
        console.log('[PAYROLL] Updated:', data);
        
        const tbody = document.querySelector('table tbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            if (rows.length > 0) {
                rows[0].style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
                setTimeout(() => {
                    rows[0].style.backgroundColor = '';
                }, 1500);
            }
        }

        showNotification('Payroll record updated in real-time', 'info');
    });

    console.log('[PAYROLL] Real-time listeners initialized');
});
