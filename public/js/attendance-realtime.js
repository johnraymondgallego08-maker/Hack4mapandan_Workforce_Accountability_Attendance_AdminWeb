/**
 * Real-Time Updates Handler for Attendance Monitor
 */
document.addEventListener('DOMContentLoaded', () => {
    if (typeof realtime === 'undefined') {
        console.warn('[ATTENDANCE] Realtime client not available');
        return;
    }

    console.log('[ATTENDANCE] Initializing real-time handler...');
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

    // Handle record deleted in real-time
    realtime.on('attendance-deleted', (data) => {
        console.log('[ATTENDANCE] Real-time update - record deleted:', data);
        const rows = document.querySelectorAll('#attendanceTable tbody tr');
        rows.forEach((row) => {
            const deleteBtn = row.querySelector('.delete-attendance');
            if (deleteBtn && deleteBtn.getAttribute('data-id') === data.id) {
                row.style.opacity = '0.5';
                row.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                setTimeout(() => {
                    row.remove();
                    // Trigger table refresh if you have a pagination manager
                    if (window.attendanceTableManager) window.attendanceTableManager.refresh();
                }, 500);
                showNotification('A record was deleted by another admin', 'info');
            }
        });
    });

    // Handle record updated in real-time
    realtime.on('attendance-updated', (data) => {
        console.log('[ATTENDANCE] Real-time update - record updated:', data);
        const rows = document.querySelectorAll('#attendanceTable tbody tr');
        rows.forEach((row) => {
            const editBtn = row.querySelector('a[href*="/attendance/edit/"]');
            if (editBtn && editBtn.href.includes(data.id)) {
                row.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                
                // Update cells with new data
                if (data.timeIn) row.querySelector('.mono-text.accent-info:nth-child(2)').textContent = data.timeIn;
                if (data.timeOut) row.querySelector('.mono-text.accent-info:nth-child(3)').textContent = data.timeOut;
                if (data.hoursWorked) row.querySelector('.hours-col').textContent = data.hoursWorked;
                
                // Update Status Badges
                const badges = row.querySelectorAll('.status-badge');
                if (data.dailyStatus && badges[0]) {
                    badges[0].textContent = data.dailyStatus;
                    badges[0].className = `status-badge status-${data.dailyStatus.toLowerCase()}`;
                }

                setTimeout(() => {
                    row.style.backgroundColor = '';
                }, 3000);
                showNotification('A record was updated', 'info');
            }
        });
    });
});