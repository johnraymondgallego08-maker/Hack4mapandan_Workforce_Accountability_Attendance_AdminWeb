/**
 * Real-Time Updates Handler for Manage Events Page
 * Include this in manage-events.ejs view
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') {
        console.warn('[EVENTS] Realtime client not available');
        return;
    }

    console.log('[EVENTS] Initializing real-time handler...');

    const isPublishedStatus = (value) => String(value || '').trim().toLowerCase() === 'public';
    const normalizeStatus = (value) => isPublishedStatus(value) ? 'Public' : 'Draft';

    const getTableBody = (status) => {
        const tableId = isPublishedStatus(status) ? 'publishedEventsTableBody' : 'draftEventsTableBody';
        return document.getElementById(tableId);
    };

    const getTable = (status) => {
        const tableId = isPublishedStatus(status) ? 'publishedEventsTable' : 'draftEventsTable';
        return document.getElementById(tableId);
    };

    const getEmptyState = (status) => {
        const emptyStateId = isPublishedStatus(status) ? 'publishedEmptyState' : 'draftEmptyState';
        return document.getElementById(emptyStateId);
    };

    const toDateValue = (value) => {
        if (!value) return null;
        if (value.toDate && typeof value.toDate === 'function') return value.toDate();
        if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatScheduleLabel = (data) => {
        const dateValue = toDateValue(data.eventDate || data.publishDate || data.date);
        const timeValue = String(data.eventTime || '').trim();
        const parts = [];

        if (dateValue) {
            parts.push(dateValue.toLocaleDateString('en-US', {
                timeZone: 'Asia/Manila',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }));
        }

        if (timeValue) {
            parts.push(timeValue);
        }

        return parts.join(' at ') || '—';
    };

    const truncateSummary = (value) => {
        const summary = String(value || '');
        return summary.length > 80 ? `${summary.substring(0, 77)}...` : summary;
    };

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getSafeSelector = (id) => {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return `tr[data-record-id="${window.CSS.escape(id)}"]`;
        }

        return `tr[data-record-id="${String(id).replace(/"/g, '\\"')}"]`;
    };

    const updateSectionState = (status) => {
        const tbody = getTableBody(status);
        const table = getTable(status);
        const emptyState = getEmptyState(status);
        if (!tbody || !table || !emptyState) return;

        const hasRows = tbody.querySelectorAll('tr').length > 0;
        table.style.display = hasRows ? '' : 'none';
        emptyState.style.display = hasRows ? 'none' : '';
    };

    const showNotification = (message, type = 'info') => {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: type.charAt(0).toUpperCase() + type.slice(1),
                text: message,
                icon: type,
                timer: 3000,
                position: 'center',
                showConfirmButton: false
            });
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    };

    const buildRowMarkup = (data, csrfToken) => {
        const normalizedStatus = normalizeStatus(data.status);
        const dateValue = toDateValue(data.eventDate || data.publishDate || data.date);
        const timestamp = dateValue ? dateValue.getTime() : 0;
        const safeId = encodeURIComponent(data.id);

        return `
            <tr data-record-id="${escapeHtml(data.id)}" data-record-status="${escapeHtml(normalizedStatus)}" data-title="${escapeHtml(data.title || '')}" data-date="${timestamp}">
                <td style="padding:0.5rem; vertical-align:middle;">
                    <strong>${escapeHtml(data.title || 'Untitled')}</strong><br>
                    <small style="color:var(--text-muted);">${escapeHtml(truncateSummary(data.summary))}</small>
                </td>
                <td style="padding:0.5rem; text-align:center;">${escapeHtml(data.type || 'announcement')}</td>
                <td style="padding:0.5rem; text-align:center;">${escapeHtml(data.scheduleLabel || formatScheduleLabel(data))}</td>
                <td style="padding:0.5rem; text-align:center;">${escapeHtml(normalizedStatus)}</td>
                <td style="padding:0.5rem; text-align:center;">
                    <div style="display:flex; gap:0.35rem; flex-wrap:nowrap; justify-content:center; align-items:center; overflow-x:auto; -webkit-overflow-scrolling:touch; white-space:nowrap;">
                        <a href="/manage-events/edit/${safeId}" class="btn-action" title="Edit" aria-label="Edit" style="margin:0;">
                            <i data-lucide="edit"></i>
                        </a>
                        <form action="/manage-events/delete/${safeId}" method="POST" style="display:inline-block; margin:0;">
                            <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                            <button type="submit" class="btn-action btn-delete" title="Delete" aria-label="Delete" style="margin:0;">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </form>
                    </div>
                </td>
            </tr>
        `;
    };

    const upsertRow = (data) => {
        if (!data || !data.id) return;

        const csrfToken = document.querySelector('input[name="_csrf"]')?.value || '';
        const normalizedStatus = normalizeStatus(data.status);
        const targetBody = getTableBody(normalizedStatus);
        if (!targetBody) {
            console.warn('[EVENTS] No target table body found for status:', normalizedStatus);
            return;
        }

        const existingRow = document.querySelector(getSafeSelector(data.id));
        const wrapper = document.createElement('tbody');
        wrapper.innerHTML = buildRowMarkup({ ...data, status: normalizedStatus }, csrfToken).trim();
        const newRow = wrapper.firstElementChild;

        if (!newRow) return;

        if (existingRow) {
            existingRow.replaceWith(newRow);
        } else {
            targetBody.insertBefore(newRow, targetBody.firstChild);
        }

        if (newRow.parentElement !== targetBody) {
            targetBody.insertBefore(newRow, targetBody.firstChild);
        }

        updateSectionState('Public');
        updateSectionState('Draft');

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    };

    const removeRow = (id) => {
        if (!id) return;
        const row = document.querySelector(getSafeSelector(id));
        if (row) {
            row.remove();
        }

        updateSectionState('Public');
        updateSectionState('Draft');
    };

    realtime.joinRoom('events');
    console.log('[EVENTS] Joined events room');

    const createForm = document.querySelector('form[action="/manage-events/create"]');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[EVENTS] Form submitted - requiring confirmation');

            if (typeof Swal === 'undefined') {
                if (confirm('Create this event or announcement?')) {
                    submitEventForm();
                }
                return;
            }

            Swal.fire({
                title: 'Create Post',
                text: 'Publish this new event or announcement?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Create',
                cancelButtonText: 'Cancel'
            }).then((result) => {
                if (result.isConfirmed) {
                    submitEventForm();
                }
            });

            async function submitEventForm() {
                const formData = new FormData(createForm);

                try {
                    const response = await fetch('/manage-events/create', {
                        method: 'POST',
                        body: formData,
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log('[EVENTS] Event created successfully');
                        showNotification('Event created successfully!', 'success');
                        createForm.reset();
                        const preview = document.getElementById('coverPreview');
                        if (preview) preview.style.display = 'none';
                    } else {
                        const payload = await response.json().catch(() => null);
                        console.error('[EVENTS] Error:', payload);
                        showNotification(payload?.error || 'Failed to create event', 'error');
                    }
                } catch (error) {
                    console.error('[EVENTS] Request error:', error);
                    showNotification('Network error', 'error');
                }
            }
        });
    }

    realtime.on('event-created', (data) => {
        console.log('[EVENTS] Real-time update - new event created:', data);
        upsertRow(data);
        console.log('[EVENTS] Row added to matching table');
        showNotification('New event appeared!', 'success');
    });

    realtime.on('event-updated', (data) => {
        console.log('[EVENTS] Real-time update - event updated:', data);
        upsertRow(data);

        const row = document.querySelector(getSafeSelector(data.id));
        if (row) {
            row.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
            setTimeout(() => {
                row.style.backgroundColor = '';
            }, 2000);
        }

        showNotification('Event updated by another user', 'info');
    });

    realtime.on('event-deleted', (data) => {
        console.log('[EVENTS] Real-time update - event deleted:', data);

        const row = document.querySelector(getSafeSelector(data.id));
        if (row) {
            row.style.opacity = '0.5';
            setTimeout(() => {
                removeRow(data.id);
            }, 500);
        } else {
            removeRow(data.id);
        }

        showNotification('Event deleted by another user', 'info');
    });

    console.log('[EVENTS] Real-time listeners initialized');

    const editForm = document.querySelector('form[action*="/manage-events/edit/"]');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[EVENTS] Edit form submitted - requiring confirmation');

            if (typeof Swal === 'undefined') {
                if (confirm('Save these changes to the event or announcement?')) {
                    submitEditForm();
                }
                return;
            }

            Swal.fire({
                title: 'Update Post',
                text: 'Save these changes to the event or announcement?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Update',
                cancelButtonText: 'Cancel'
            }).then((result) => {
                if (result.isConfirmed) {
                    submitEditForm();
                }
            });

            async function submitEditForm() {
                const formData = new FormData(editForm);

                try {
                    const response = await fetch(editForm.action, {
                        method: 'POST',
                        body: formData,
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log('[EVENTS] Event updated successfully');
                        showNotification('Event updated successfully!', 'success');
                        setTimeout(() => {
                            window.location.href = '/manage-events';
                        }, 1500);
                    } else {
                        const payload = await response.json().catch(() => null);
                        console.error('[EVENTS] Update error:', payload);
                        showNotification(payload?.error || 'Failed to update event', 'error');
                    }
                } catch (error) {
                    console.error('[EVENTS] Request error:', error);
                    showNotification('Network error', 'error');
                }
            }
        });
    }

    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form.action || !form.action.includes('/manage-events/delete/')) {
            return;
        }

        e.preventDefault();
        console.log('[EVENTS] Delete form submitted - requiring confirmation');

        if (typeof Swal === 'undefined') {
            if (confirm('Delete this event or announcement?')) {
                submitDeleteForm();
            }
            return;
        }

        Swal.fire({
            title: 'Delete Post',
            text: 'Delete this event or announcement? This cannot be undone.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#d33'
        }).then((result) => {
            if (result.isConfirmed) {
                submitDeleteForm();
            }
        });

        async function submitDeleteForm() {
            const formData = new FormData(form);

            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json'
                    }
                });

                if (response.ok) {
                    console.log('[EVENTS] Event deleted successfully');
                    showNotification('Event deleted successfully!', 'success');
                } else {
                    const payload = await response.json().catch(() => null);
                    console.error('[EVENTS] Delete error:', payload);
                    showNotification(payload?.error || 'Failed to delete event', 'error');
                }
            } catch (error) {
                console.error('[EVENTS] Request error:', error);
                showNotification('Network error', 'error');
            }
        }
    }, true);

    updateSectionState('Public');
    updateSectionState('Draft');
});
