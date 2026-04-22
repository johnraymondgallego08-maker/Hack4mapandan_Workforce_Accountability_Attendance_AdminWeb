/**
 * Real-Time Updates Handler for Overtime Page
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') return;

    realtime.joinRoom('overtime');
    const pendingBody = document.getElementById('overtimePendingBody');
    const historyBody = document.getElementById('overtimeHistoryBody');
    const pendingActionIds = new Set();
    const refreshManagedTables = () => {
        if (typeof window.refreshManagedTable === 'function') {
            window.refreshManagedTable('overtimeTable');
            window.refreshManagedTable('historyTable');
        }
    };

    const getNormalizedStatus = (data = {}) => {
        const rawStatus = String(data.otStatus || data.status || '').trim().toLowerCase();
        if (rawStatus === 'approved') return 'Approved';
        if (rawStatus === 'rejected') return 'Rejected';
        if (rawStatus === 'pending approval' || rawStatus === 'pending' || rawStatus === 'ot') return 'Pending Approval';
        if (data.isOTRequested === true || String(data.isOTRequested || '').trim().toLowerCase() === 'true') return 'Pending Approval';
        return '';
    };

    const getStatusBadgeClass = (status) => {
        if (status === 'Approved') return 'status-present';
        if (status === 'Rejected') return 'status-absent';
        return 'status-late';
    };

    const getDisplayEmployee = (data = {}) => data.employee || data.employeeName || 'Unknown';
    const getDisplayEmployeeId = (data = {}) => data.employeeId || data.userId || 'N/A';
    const getDisplayDate = (data = {}) => data.date || data.requestedDate || 'N/A';
    const getDisplayHours = (data = {}) => {
        const value = data.otHours ?? data.hours ?? data.totalHours ?? data.workHours;
        return value === undefined || value === null || value === '' || value === 'N/A' ? 'N/A' : `${value}h`;
    };
    const getDisplayReason = (data = {}) => data.reason || data.otReason || data.remarks || data.note || 'OT request from attendance log';
    const getActorName = (data = {}) => {
        const history = Array.isArray(data.history) ? data.history : [];
        const latestAction = [...history].reverse().find((entry) => entry && (entry.action === 'Approved' || entry.action === 'Rejected'));
        return (latestAction && (latestAction.name || latestAction.byName || latestAction.by)) || 'N/A';
    };
    const getActionTimestamp = (data = {}) => data.actionDate || data.approvedAt || data.rejectedAt || new Date().toLocaleString();

    const ensurePendingEmptyState = () => {
        if (!pendingBody) return;
        const dataRows = pendingBody.querySelectorAll('tr[data-overtime-id]');
        const emptyRow = pendingBody.querySelector('tr[data-empty-state="true"]');
        if (dataRows.length === 0 && !emptyRow) {
            const row = document.createElement('tr');
            row.setAttribute('data-empty-state', 'true');
            row.innerHTML = '<td colspan="7" style="padding: 3rem; text-align: center; color: var(--text-muted); font-style: italic;">No pending overtime requests found.</td>';
            pendingBody.appendChild(row);
        } else if (dataRows.length > 0 && emptyRow) {
            emptyRow.remove();
        }
    };

    const ensureHistoryEmptyStateRemoved = () => {
        if (!historyBody) return;
        const emptyRow = historyBody.querySelector('tr[data-empty-state="true"]');
        if (emptyRow) emptyRow.remove();
    };

    const createPendingRow = (data) => {
        const row = document.createElement('tr');
        row.dataset.overtimeId = data.id;
        const status = getNormalizedStatus(data) || 'Pending Approval';
        row.innerHTML = `
            <td style="font-family: monospace; font-size: 0.75rem; color: var(--text-muted);">#${String(data.id || '').substring(0, 8)}</td>
            <td>
                <div style="font-weight: 700; color: var(--text-heading);">${getDisplayEmployee(data)}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${getDisplayEmployeeId(data)}</div>
            </td>
            <td style="color: var(--text-muted); font-size: 0.9rem;">${getDisplayDate(data)}</td>
            <td style="font-weight: 800; color: var(--accent-indigo); font-family: monospace;">${getDisplayHours(data)}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 0.85rem;" title="${getDisplayReason(data)}">${getDisplayReason(data)}</td>
            <td class="text-right">
                <span class="status-badge ${getStatusBadgeClass(status)}">${status}</span>
            </td>
            <td style="text-align: right;">
                <div class="table-action-group">
                    <form action="/manage-overtime/approve/${data.id}" method="POST" class="inline">
                        <button type="submit" class="btn-action btn-approve" title="Approve">
                            <i data-lucide="check" style="width: 18px; height: 18px;"></i>
                        </button>
                    </form>
                    <form action="/manage-overtime/reject/${data.id}" method="POST" class="inline">
                        <button type="submit" class="btn-action btn-reject" title="Reject">
                            <i data-lucide="x" style="width: 18px; height: 18px;"></i>
                        </button>
                    </form>
                </div>
            </td>
        `;
        return row;
    };

    const upsertPendingRow = (data) => {
        if (!pendingBody) return;
        const existingRow = pendingBody.querySelector(`tr[data-overtime-id="${data.id}"]`);
        const status = getNormalizedStatus(data);

        if (status !== 'Pending Approval') {
            if (existingRow) existingRow.remove();
            ensurePendingEmptyState();
            refreshManagedTables();
            return;
        }

        const nextRow = createPendingRow(data);
        if (existingRow) {
            existingRow.replaceWith(nextRow);
        } else {
            pendingBody.prepend(nextRow);
        }

        ensurePendingEmptyState();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        refreshManagedTables();
    };

    const prependHistoryRow = (data, status) => {
        if (!historyBody || (status !== 'Approved' && status !== 'Rejected')) return;

        ensureHistoryEmptyStateRemoved();
        const row = document.createElement('tr');
        row.dataset.historyKey = `${data.id}-${status}-${getActionTimestamp(data)}`;
        row.innerHTML = `
            <td style="font-weight: 700; color: var(--text-heading);">${getDisplayEmployee(data)}</td>
            <td>
                <span class="status-badge ${getStatusBadgeClass(status)}">${status}</span>
            </td>
            <td style="color: var(--text-muted);">${getActorName(data)}</td>
            <td class="text-right" style="color: var(--text-muted); font-family: monospace; font-size: 0.85rem;">
                ${getActionTimestamp(data)}
            </td>
        `;

        const existing = historyBody.querySelector(`tr[data-history-key="${row.dataset.historyKey}"]`);
        if (existing) {
            existing.replaceWith(row);
        } else {
            historyBody.prepend(row);
        }
        refreshManagedTables();
    };

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
        const overtimeId = form.action.split('/').pop();

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
                pendingActionIds.add(overtimeId);
                showNotification(`Overtime ${actionText}d successfully!`, 'success');
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
        const normalizedStatus = getNormalizedStatus(data);
        upsertPendingRow(data);
        prependHistoryRow(data, normalizedStatus);

        const affectedRow = pendingBody ? pendingBody.querySelector(`tr[data-overtime-id="${data.id}"]`) : null;
        if (affectedRow) {
            affectedRow.style.backgroundColor = 'rgba(156, 39, 176, 0.1)';
            setTimeout(() => { affectedRow.style.backgroundColor = ''; }, 2000);
        }

        if (pendingActionIds.has(data.id)) {
            pendingActionIds.delete(data.id);
            return;
        }

        if (normalizedStatus) {
            showNotification(`Overtime request: ${normalizedStatus}`, 'info');
        }
    });

    console.log('[OVERTIME] Real-time listeners initialized');
});
