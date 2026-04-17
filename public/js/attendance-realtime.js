/**
 * Real-Time Updates Handler for Attendance Pages
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') return;

    realtime.joinRoom('attendance');

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

    realtime.on('attendance-updated', (data) => {
        console.log('[ATTENDANCE] Updated:', data);
        
        // Find the corresponding row
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0 && cells[0].textContent.includes(data.uid)) {
                // Highlight updated row
                row.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                setTimeout(() => {
                    row.style.backgroundColor = '';
                }, 1500);
            }
        });

        showNotification('Attendance record updated in real-time', 'info');
    });

    console.log('[ATTENDANCE] Real-time listeners initialized');
});
