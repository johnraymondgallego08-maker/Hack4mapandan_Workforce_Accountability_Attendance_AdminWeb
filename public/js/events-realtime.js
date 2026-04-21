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

    // Join events room for real-time updates
    realtime.joinRoom('events');
    console.log('[EVENTS] Joined events room');

    const getTableBody = () => {
        const tables = document.querySelectorAll('table tbody');
        return tables.length > 0 ? tables[0] : null;
    };

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
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    };

    // Handle form submission via AJAX to keep connection alive
    const createForm = document.querySelector('form[action="/manage-events/create"]');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[EVENTS] Form submitted - requiring confirmation');

            // Show confirmation dialog
            if (typeof Swal === 'undefined') {
                // Fallback if SweetAlert not available
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
                            'Accept': 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log('[EVENTS] Event created successfully');
                        showNotification('Event created successfully!', 'success');
                        createForm.reset();
                        // Firestore listeners will update the table in real-time
                    } else {
                        const text = await response.text();
                        console.error('[EVENTS] Error:', text);
                        showNotification('Failed to create event', 'error');
                    }
                } catch (error) {
                    console.error('[EVENTS] Request error:', error);
                    showNotification('Network error', 'error');
                }
            }
        });
    }

    // Handle new event created
    realtime.on('event-created', (data) => {
        console.log('[EVENTS] Real-time update - new event created:', data);
        
        // Remove any optimistic ghost rows
        const optRow = document.querySelector('[id^="opt-"]');
        if (optRow) optRow.remove();

        const tbody = getTableBody();
        if (!tbody) {
            console.warn('[EVENTS] No table body found');
            return;
        }

        // Fix: Retrieve the CSRF token from the existing form to ensure 
        // the delete button works on rows added via real-time.
        const csrfToken = document.querySelector('input[name="_csrf"]')?.value || '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding:0.5rem; vertical-align:middle;"><strong>${data.title || 'Untitled'}</strong><br><small style="color:var(--text-muted);">${(data.summary || '').substring(0, 77)}</small></td>
            <td style="padding:0.5rem; text-align:center;">${data.type || 'announcement'}</td>
            <td style="padding:0.5rem; text-align:center;">${data.scheduleLabel || '—'}</td>
            <td style="padding:0.5rem; text-align:center;">${data.status || 'Public'}</td>
            <td style="padding:0.5rem; text-align:center;">
                <div style="display:flex; gap:0.35rem; flex-wrap:nowrap; justify-content:center; align-items:center;">
                    <a href="/manage-events/edit/${data.id}" class="btn-action" title="Edit"><i data-lucide="edit"></i></a>
                    <form action="/manage-events/delete/${data.id}" method="POST" style="display:inline-block; margin:0;">
                        <input type="hidden" name="_csrf" value="${csrfToken}">
                        <button type="submit" class="btn-action btn-delete" title="Delete"><i data-lucide="trash-2"></i></button>
                    </form>
                </div>
            </td>
        `;

        // Add to top of table
        if (tbody.firstChild) {
            tbody.insertBefore(row, tbody.firstChild);
        } else {
            tbody.appendChild(row);
        }

        // Reinitialize icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }

        console.log('[EVENTS] Row added to table');
        showNotification('New event appeared!', 'success');
    });

    // Handle event updated
    realtime.on('event-updated', (data) => {
        console.log('[EVENTS] Real-time update - event updated:', data);
        
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach((row) => {
            const editLink = row.querySelector('a[href*="/manage-events/edit/"]');
            if (editLink && editLink.href.includes(data.id)) {
                row.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                setTimeout(() => {
                    row.style.backgroundColor = '';
                }, 2000);
                
                showNotification('Event updated by another user', 'info');
            }
        });
    });

    // Handle event deleted
    realtime.on('event-deleted', (data) => {
        console.log('[EVENTS] Real-time update - event deleted:', data);
        
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach((row) => {
            const editLink = row.querySelector('a[href*="/manage-events/edit/"]');
            if (editLink && editLink.href.includes(data.id)) {
                row.style.opacity = '0.5';
                setTimeout(() => {
                    row.remove();
                }, 500);
                
                showNotification('Event deleted by another user', 'info');
            }
        });
    });

    console.log('[EVENTS] Real-time listeners initialized');

    // Handle edit form submission (on edit-event.ejs page)
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
                const eventId = editForm.action.split('/').pop();
                
                try {
                    const response = await fetch(editForm.action, {
                        method: 'POST',
                        body: formData,
                        credentials: 'same-origin',
                        headers: {
                            'Accept': 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log('[EVENTS] Event updated successfully');
                        showNotification('Event updated successfully!', 'success');
                        // Return to manage-events after brief delay
                        setTimeout(() => {
                            window.location.href = '/manage-events';
                        }, 1500);
                    } else {
                        const text = await response.text();
                        console.error('[EVENTS] Update error:', text);
                        showNotification('Failed to update event', 'error');
                    }
                } catch (error) {
                    console.error('[EVENTS] Request error:', error);
                    showNotification('Network error', 'error');
                }
            }
        });
    }

    // Handle delete form submission (inline forms in manage-events.ejs table)
    // Note: These forms are added dynamically, so we use event delegation
    document.addEventListener('submit', (e) => {
        const form = e.target;
        
        // Check if this is a delete form
        if (!form.action.includes('/manage-events/delete/')) {
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
                        'Accept': 'application/json'
                    }
                });

                if (response.ok) {
                    console.log('[EVENTS] Event deleted successfully');
                    showNotification('Event deleted successfully!', 'success');
                    // Don't reload - let the realtime listeners handle the table update
                } else {
                    const text = await response.text();
                    console.error('[EVENTS] Delete error:', text);
                    showNotification('Failed to delete event', 'error');
                }
            } catch (error) {
                console.error('[EVENTS] Request error:', error);
                showNotification('Network error', 'error');
            }
        }
    }, true); // Use capture phase for event delegation on dynamically added forms
});
