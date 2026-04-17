/**
 * Real-Time Updates Handler for Edit Event Page
 * Include this in edit-event.ejs view
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') {
        console.warn('[EDIT-EVENT] Realtime client not available');
        return;
    }

    console.log('[EDIT-EVENT] Initializing real-time handler...');

    // Join events room for real-time updates
    realtime.joinRoom('events');
    console.log('[EDIT-EVENT] Joined events room');

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

    // Handle edit form submission via AJAX to keep connection alive
    const editForm = document.querySelector('form[action*="/manage-events/edit/"]');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[EDIT-EVENT] Form submitted - requiring confirmation');

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
                            'Accept': 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log('[EDIT-EVENT] Event updated successfully');
                        showNotification('Event updated successfully!', 'success');
                        // Return to manage-events after brief delay
                        setTimeout(() => {
                            window.location.href = '/manage-events';
                        }, 1500);
                    } else {
                        const text = await response.text();
                        console.error('[EDIT-EVENT] Update error:', text);
                        showNotification('Failed to update event', 'error');
                    }
                } catch (error) {
                    console.error('[EDIT-EVENT] Request error:', error);
                    showNotification('Network error', 'error');
                }
            }
        });
    }

    console.log('[EDIT-EVENT] Real-time handler initialized');
});
