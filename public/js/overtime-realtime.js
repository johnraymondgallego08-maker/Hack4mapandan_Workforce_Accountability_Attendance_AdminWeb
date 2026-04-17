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

    // Handle Approve/Reject form submissions via AJAX to keep connection alive
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (!form.action.includes('/manage-overtime/approve/') && !form.action.includes('/manage-overtime/reject/')) {
            return;
        }

        e.preventDefault();
        const isApprove = form.action.includes('approve');
        const actionText = isApprove ? 'approve' : 'reject';

        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: `${actionText.charAt(0).toUpperCase() + actionText.slice(1)} Overtime?`,
                text: `Are you sure you want to ${actionText} this request?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'No'
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
                showNotification(`Overtime ${actionText}d successfully!`, 'success');
                // Real-time listener below will update the table row
            } else {
                showNotification(`Failed to ${actionText} request`, 'error');
            }
        } catch (error) {
            console.error('[OVERTIME] AJAX error:', error);
            showNotification('Network error occurred', 'error');
        }
    });

    realtime.on('overtime-updated', (data) => {
        console.log('[OVERTIME] Updated:', data);
        
        const tbody = document.querySelector('table tbody');
        if (tbody) {
            // Remove "No records found" row if it exists
            const emptyRow = tbody.querySelector('[data-empty-state="true"]');
            if (emptyRow) emptyRow.remove();

            const rows = tbody.querySelectorAll('tr');
            let rowFound = false;

            rows.forEach(row => {
                // Check if the row has the ID in its dataset or in any form action
                const rowId = row.dataset.id;
                // Match row by checking action URLs in forms (they contain the ID)
                const forms = row.querySelectorAll('form');
                const isMatch = (rowId === data.id) || Array.from(forms).some(f => f.action.includes(data.id));
                
                if (isMatch) {
                    rowFound = true;
                    realtime.updateExistingRow(row, data);
                }
            });

            // If row doesn't exist, create it (New Request)
            if (!rowFound) {
                const csrfToken = document.querySelector('input[name="_csrf"]')?.value || '';
                const newRow = document.createElement('tr');
                newRow.dataset.id = data.id; // Store ID for future real-time matches
                const status = data.otStatus || 'Pending Approval';
                const statusClass = status === 'Approved' ? 'bg-success' : (status === 'Rejected' ? 'bg-danger' : 'bg-warning');
                
                newRow.innerHTML = `
                    <td style="padding:0.75rem;">${data.employeeName || data.employee || 'New Request'}</td>
                    <td style="padding:0.75rem; text-align:center;">${data.date || 'Just now'}</td>
                    <td style="padding:0.75rem; text-align:center;">${data.otHours || data.hours || '0'} hrs</td>
                    <td style="padding:0.75rem; text-align:center;"><span class="status-badge ${statusClass}">${status}</span></td>
                    <td style="padding:0.75rem; text-align:center;">
                        <div style="display:flex; gap:0.25rem; justify-content:center;">
                            <form action="/manage-overtime/approve/${data.id}" method="POST" style="margin:0;">
                                <input type="hidden" name="_csrf" value="${csrfToken}">
                                <button type="submit" class="btn-action" title="Approve" style="color:var(--success);"><i data-lucide="check-circle"></i></button>
                            </form>
                            <form action="/manage-overtime/reject/${data.id}" method="POST" style="margin:0;">
                                <input type="hidden" name="_csrf" value="${csrfToken}">
                                <button type="submit" class="btn-action" title="Reject" style="color:var(--danger);"><i data-lucide="x-circle"></i></button>
                            </form>
                        </div>
                    </td>
                `;
                tbody.insertBefore(newRow, tbody.firstChild);
                newRow.style.backgroundColor = 'rgba(156, 39, 176, 0.2)';
                if (typeof lucide !== 'undefined') lucide.createIcons();
                setTimeout(() => { newRow.style.backgroundColor = ''; }, 3000);
            }
        }

        showNotification(`Overtime request: ${data.otStatus || 'Pending Approval'}`, 'info');
    });

    // Helper to update existing row data
    realtime.updateExistingRow = (row, data) => {
                    // Highlight the updated row
                    row.style.backgroundColor = 'rgba(156, 39, 176, 0.1)';
                    
                    // Update the status cell badge
                    const statusBadge = row.querySelector('.status-badge');
                    const newStatus = data.otStatus || 'Pending Approval';
                    if (statusBadge) {
                        statusBadge.textContent = newStatus;
                        statusBadge.className = `status-badge ${newStatus === 'Approved' ? 'bg-success' : (newStatus === 'Rejected' ? 'bg-danger' : 'bg-warning')}`;
                    }

                    setTimeout(() => {
                        row.style.backgroundColor = '';
                    }, 2000);
    };

    console.log('[OVERTIME] Real-time listeners initialized');
});
