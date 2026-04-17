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

    // Intercept Approve/Reject/Delete forms to prevent page navigation (disconnection)
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (!form.action.includes('/manage-leave/approve/') && 
            !form.action.includes('/manage-leave/reject/') &&
            !form.action.includes('/manage-leave/delete/')) {
            return;
        }

        e.preventDefault();
        const action = form.action.includes('approve') ? 'approve' : (form.action.includes('reject') ? 'reject' : 'delete');
        
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: `${action.charAt(0).toUpperCase() + action.slice(1)} Leave?`,
                text: `Are you sure you want to ${action} this request?`,
                icon: action === 'delete' ? 'warning' : 'question',
                showCancelButton: true,
                confirmButtonColor: action === 'delete' ? '#d33' : '#3085d6'
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
                showNotification(`Leave request ${action}d successfully!`, 'success');
            } else {
                showNotification(`Failed to ${action} request`, 'error');
            }
        } catch (error) {
            showNotification('Network error occurred', 'error');
        }
    });

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
