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
                position: 'center',
                showConfirmButton: false,
            });
        }
    };

    // Intercept Process Payroll to prevent page navigation
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (!form.action.includes('/payroll/process/')) return;

        e.preventDefault();
        
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: 'Process Payroll?',
                text: 'Confirm processing for this employee.',
                icon: 'question',
                showCancelButton: true
            });
            if (!result.isConfirmed) return;
        }

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                showNotification('Payroll processed successfully!', 'success');
            } else {
                showNotification('Failed to process payroll', 'error');
            }
        } catch (error) {
            showNotification('Network error occurred', 'error');
        }
    });

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
