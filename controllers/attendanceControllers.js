const attendanceModel = require("../models/attendanceModel");
const userModel = require("../models/userModel");
const overtimeModel = require("../models/overtimeModel");
const leaveModel = require("../models/leaveModel");
const payrollModel = require("../models/payrollModel");
const holidayModel = require("../models/holidayModel");
const { db } = require('../config/firebaseAdmin');
const fs = require('fs');
const path = require('path');
const EMPLOYEE_IMAGES_DIR = path.join(__dirname, '../public/employee_images');
const APP_TIMEZONE = 'Asia/Manila';

// Helper to safely parse dates
function parseDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
        return dateInput.toDate();
    }
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
}

// Helper to robustly parse numeric values, handling currency symbols
function getNumericValue(value) {
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$,]/g, ''); // Remove currency symbols and commas
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    }
    return parseFloat(value) || 0;
}

function getFirstDefinedValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return 0;
}

function buildDateTimeFromForm(dateValue, timeValue) {
    if (!dateValue) return null;

    const safeTime = timeValue && String(timeValue).trim() ? String(timeValue).trim() : '00:00';
    const parsed = new Date(`${dateValue}T${safeTime}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateForInput(dateInput) {
    const date = parseDate(dateInput);
    if (!date) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeForInput(dateInput) {
    const date = parseDate(dateInput);
    if (!date) return '';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function normalizeManualAttendanceForm(body = {}, existing = {}, users = []) {
    const employeeName = String(body.employeeName || existing.employeeName || existing.name || '').trim();
    const dateValue = String(body.date || '').trim();
    const timeInValue = String(body.timeIn || '').trim();
    const timeOutValue = String(body.timeOut || '').trim();
    const location = String(body.location || existing.location || '').trim();
    const requestedEmployeeId = String(body.employeeId || existing.employeeId || existing.userId || '').trim();
    const errors = [];

    if (!employeeName) errors.push('Employee name is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) errors.push('A valid attendance date is required.');
    if (!/^\d{2}:\d{2}$/.test(timeInValue)) errors.push('A valid time in is required.');
    if (timeOutValue && !/^\d{2}:\d{2}$/.test(timeOutValue)) errors.push('Time out must be a valid time.');
    if (!location) errors.push('Verification location is required.');

    const timeIn = buildDateTimeFromForm(dateValue, timeInValue);
    const timeOut = timeOutValue ? buildDateTimeFromForm(dateValue, timeOutValue) : null;
    const date = buildDateTimeFromForm(dateValue, '00:00');

    if (!timeIn) errors.push('Time in could not be parsed.');
    if (timeOutValue && !timeOut) errors.push('Time out could not be parsed.');
    if (timeIn && timeOut && timeOut < timeIn) errors.push('Time out cannot be earlier than time in.');

    if (errors.length) {
        return { errors };
    }

    const normalizedRequestedId = requestedEmployeeId.toLowerCase();
    const normalizedName = employeeName.toLowerCase();
    const matchedUser = users.find(user => {
        const userIds = [user.id, user.uid, user.employeeId, user.employeeCode]
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean);
        if (normalizedRequestedId && userIds.includes(normalizedRequestedId)) return true;
        return String(user.name || '').trim().toLowerCase() === normalizedName;
    });

    const employeeId = matchedUser
        ? String(matchedUser.id || matchedUser.uid || matchedUser.employeeId || '').trim()
        : requestedEmployeeId;

    const data = {
        employeeName,
        name: employeeName,
        date,
        location,
        timeIn,
        timeOut,
        timestamp: timeIn,
        status: existing.status || 'Present'
    };

    if (employeeId) {
        data.employeeId = employeeId;
        data.userId = existing.userId || employeeId;
    }

    return { errors: [], data };
}

// Helper to format time
function formatTime(dateInput) {
    const date = parseDate(dateInput);
    if (!date) return null;
    return date.toLocaleTimeString('en-US', {
        timeZone: APP_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Helper to format date
function formatDate(dateInput) {
    const date = parseDate(dateInput);
    if (!date) return null;
    return date.toLocaleDateString('en-US', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function startOfMonth(date) {
    const monthStart = new Date(date);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return monthStart;
}

function endOfMonth(date) {
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    return monthEnd;
}

function normalizeImagePath(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    const cleanedValue = trimmed.replace(/^['"`]+|['"`]+$/g, '').trim();
    if (!cleanedValue) return null;
    if (cleanedValue.startsWith('http://') || cleanedValue.startsWith('https://') || cleanedValue.startsWith('data:image')) {
        return cleanedValue;
    }

    const normalized = cleanedValue.replace(/\\/g, '/');
    if (normalized.startsWith('/employee_images/')) return normalized;
    if (normalized.startsWith('employee_images/')) return `/${normalized}`;
    if (normalized.startsWith('/uploads/')) return normalized;
    if (normalized.startsWith('uploads/')) return `/${normalized}`;
    if (normalized.toLowerCase().startsWith('public/employee_images/')) return normalized.slice('public'.length);
    if (normalized.toLowerCase().startsWith('public/uploads/')) return normalized.slice('public'.length);

    const publicIndex = normalized.toLowerCase().indexOf('/public/employee_images/');
    if (publicIndex >= 0) {
        return normalized.slice(publicIndex + '/public'.length);
    }
    const publicUploadsIndex = normalized.toLowerCase().indexOf('/public/uploads/');
    if (publicUploadsIndex >= 0) {
        return normalized.slice(publicUploadsIndex + '/public'.length);
    }

    return null;
}

function localImageExists(value) {
    const normalized = normalizeImagePath(value);
    if (
        !normalized ||
        (!normalized.startsWith('/employee_images/') && !normalized.startsWith('/uploads/'))
    ) {
        return false;
    }

    const absolutePath = path.join(__dirname, '../public', normalized.replace(/^\//, ''));
    return fs.existsSync(absolutePath);
}

function isRemoteImagePath(value) {
    return typeof value === 'string' && (
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:image')
    );
}

function sanitizeEmployeeFolderName(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function canonicalizeImageSource(value = '') {
    const normalized = normalizeImagePath(value);
    if (!normalized) return '';

    if (normalized.startsWith('data:image')) {
        const shortFingerprint = normalized.slice(0, 80).toLowerCase();
        return `data:${shortFingerprint}:${normalized.length}`;
    }

    if (isRemoteImagePath(normalized)) {
        try {
            const parsedUrl = new URL(normalized);
            const pathname = parsedUrl.pathname.replace(/\/+/g, '/');
            return `${parsedUrl.protocol}//${parsedUrl.host}${pathname}`.toLowerCase();
        } catch (error) {
            return normalized.split(/[?#]/)[0].replace(/\/+/g, '/').toLowerCase();
        }
    }

    return normalized.split(/[?#]/)[0].replace(/\/+/g, '/').toLowerCase();
}

function extractNormalizedImageSourcesFromRecord(record = {}, seedCandidates = []) {
    const collected = new Set();
    const visited = new Set();
    const IMAGE_KEY_PATTERN = /(image|img|photo|capture|verification|url)/i;

    const addCandidate = (value) => {
        const normalized = normalizeImagePath(value);
        if (normalized) {
            collected.add(normalized);
        }
    };

    const walk = (value, keyHint = '', depth = 0) => {
        if (value === null || value === undefined || depth > 5) return;

        if (typeof value === 'string') {
            if (
                !keyHint ||
                IMAGE_KEY_PATTERN.test(keyHint) ||
                value.includes('/employee_images/') ||
                value.includes('/uploads/') ||
                value.startsWith('http://') ||
                value.startsWith('https://') ||
                value.startsWith('data:image')
            ) {
                addCandidate(value);
            }
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) => walk(entry, keyHint, depth + 1));
            return;
        }

        if (typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        Object.entries(value).forEach(([key, nestedValue]) => {
            const nestedKeyHint = keyHint ? `${keyHint}.${key}` : key;
            const isImageLikeKey = IMAGE_KEY_PATTERN.test(String(key));

            if (typeof nestedValue === 'string' && isImageLikeKey) {
                addCandidate(nestedValue);
                return;
            }

            if (typeof nestedValue === 'string') {
                walk(nestedValue, nestedKeyHint, depth + 1);
                return;
            }

            if (Array.isArray(nestedValue) || (nestedValue && typeof nestedValue === 'object')) {
                walk(nestedValue, nestedKeyHint, depth + 1);
            }
        });
    };

    seedCandidates.forEach(addCandidate);
    walk(record);

    return Array.from(collected);
}

function buildPhotoKey(photo = {}) {
    const sources = buildPhotoSources(photo);
    const primarySource = canonicalizeImageSource(sources[0] || photo.path || '');

    const ts = parseDate(photo.timestamp);
    let minuteTimestamp = '';
    if (ts) {
        const minuteDate = new Date(ts);
        minuteDate.setSeconds(0, 0);
        minuteTimestamp = minuteDate.toISOString();
    }

    const label = String(photo.label || '').trim().toLowerCase();
    if (primarySource && minuteTimestamp) return `source:${primarySource}|minute:${minuteTimestamp}`;
    if (primarySource) return `source:${primarySource}`;
    if (minuteTimestamp && label) return `minute:${minuteTimestamp}|label:${label}`;
    if (minuteTimestamp) return `minute:${minuteTimestamp}`;
    if (label) return `label:${label}`;
    return `path:${String(photo.path || '').trim().toLowerCase()}`;
}

function buildPhotoSources(photo = {}) {
    const rawSources = Array.isArray(photo.sources) ? photo.sources : [photo.path];
    return rawSources
        .map(normalizeImagePath)
        .filter((source, index, list) => source && list.indexOf(source) === index);
}

function buildUserProfileSources(user = {}, localProfile = null) {
    const directSources = [
        user.imageUrl,
        user.imgUrl,
        user.photoUrl,
        user.profileImage,
        user.img_url,
        user.image_url,
        user['img url'],
        user.image,
        user.url,
        localProfile
    ]
        .map(normalizeImagePath)
        .filter((source, index, list) => source && list.indexOf(source) === index);

    const discoveredSources = extractNormalizedImageSourcesFromRecord(user);

    return [...directSources, ...discoveredSources]
        .filter((source, index, list) => source && list.indexOf(source) === index);
}

function upsertPhoto(photoMap, photo = {}, keyHint = null) {
    const sources = buildPhotoSources(photo);
    if (!sources.length) return;

    const key = keyHint || buildPhotoKey({ ...photo, path: sources[0] });
    const existing = photoMap.get(key);

    if (!existing) {
        photoMap.set(key, {
            ...photo,
            path: sources[0],
            sources,
            timestamp: photo.timestamp || null
        });
        return;
    }

    const mergedSources = [...buildPhotoSources(existing), ...sources]
        .filter((source, index, list) => source && list.indexOf(source) === index);

    const preferredPath = mergedSources.find(source => localImageExists(source)) || mergedSources[0];

    photoMap.set(key, {
        ...existing,
        ...photo,
        path: preferredPath,
        sources: mergedSources,
        timestamp: existing.timestamp || photo.timestamp || null,
        label: existing.label || photo.label
    });
}

function extractCaptureDateFromFilename(fileName = '') {
    const match = String(fileName).match(/^capture_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const [, datePart, hour, minute, second] = match;
    const parsed = new Date(`${datePart}T${hour}:${minute}:${second}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLocalEmployeeImages({ userId = '', name = '' } = {}) {
    const safeUserId = String(userId || '').trim();
    const safeName = sanitizeEmployeeFolderName(name).toLowerCase();

    if ((!safeUserId && !safeName) || !fs.existsSync(EMPLOYEE_IMAGES_DIR)) {
        return { profile: null, captures: [] };
    }

    const candidateFolders = fs.readdirSync(EMPLOYEE_IMAGES_DIR, { withFileTypes: true })
        .filter(entry => {
            if (!entry.isDirectory()) return false;

            const folderName = entry.name.toLowerCase();
            const idMatch = safeUserId && folderName.endsWith(`_${safeUserId.toLowerCase()}`);
            const nameMatch = safeName && folderName.startsWith(`${safeName}_`);
            return idMatch || nameMatch;
        })
        .sort((a, b) => {
            const aExactId = safeUserId && a.name.toLowerCase().endsWith(`_${safeUserId.toLowerCase()}`) ? 1 : 0;
            const bExactId = safeUserId && b.name.toLowerCase().endsWith(`_${safeUserId.toLowerCase()}`) ? 1 : 0;
            return bExactId - aExactId;
        });

    if (candidateFolders.length === 0) {
        return { profile: null, captures: [] };
    }

    let profile = null;
    const captures = [];

    candidateFolders.forEach(folder => {
        const folderPath = path.join(EMPLOYEE_IMAGES_DIR, folder.name);
        const files = fs.readdirSync(folderPath);

        if (!profile) {
            const profileFile = ['profile.jpg', 'profile.jpeg', 'profile.png', 'profile.webp']
                .find(fileName => files.includes(fileName));
            if (profileFile) {
                profile = `/employee_images/${folder.name}/${profileFile}`;
            }
        }

        files
            .filter(fileName => /^capture_.*\.(jpg|jpeg|png|webp)$/i.test(fileName))
            .forEach(fileName => {
                const timestamp = extractCaptureDateFromFilename(fileName);
                captures.push({
                    path: `/employee_images/${folder.name}/${fileName}`,
                    label: timestamp
                        ? `Verification - ${formatDate(timestamp)} ${formatTime(timestamp)}`
                        : 'Verification',
                    timestamp
                });
            });
    });

    const uniqueCaptures = captures
        .filter((photo, index, list) => photo.path && list.findIndex(candidate => candidate.path === photo.path) === index)
        .sort((a, b) => {
            const aTime = a.timestamp ? a.timestamp.getTime() : 0;
            const bTime = b.timestamp ? b.timestamp.getTime() : 0;
            return bTime - aTime;
        });

    return { profile, captures: uniqueCaptures };
}

async function fetchAttendanceDocsForImageRecognition() {
    const PAGE_SIZE = 1000;
    const orderedDocs = [];
    let lastDoc = null;
    const MAX_RECORDS = 2000; // Limit total records to prevent Vercel timeout
    try {
        while (true) {
            let query = db.collection('attendance')
                .orderBy('timestamp', 'desc')
                .limit(PAGE_SIZE);

            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            if (snapshot.empty) break;
            orderedDocs.push(...snapshot.docs);
            lastDoc = snapshot.docs[snapshot.docs.length - 1];

            // Stop if we have enough records or reached the end
            if (snapshot.size < PAGE_SIZE || orderedDocs.length >= MAX_RECORDS) break;
        }

        return orderedDocs;
    } catch (queryError) {
        console.warn('[IMAGE RECOGNITION] Ordered pagination failed, falling back to unordered fetch:', queryError.message);
        const fallbackSnapshot = await db.collection('attendance').get();
        return fallbackSnapshot.docs;
    }
}

function startOfDay(date) {
    if (!date) return null;
    const newDate = new Date(date);
    if (isNaN(newDate.getTime())) return null;
    newDate.setHours(0, 0, 0, 0);
    return newDate;
}

function calculateWorkedHours(record, fallbackEnd = null) {
    const start = parseDate(record.timeIn || record.timestamp || record.date);
    if (!start) return null;

    const end = parseDate(record.timeOut) || parseDate(fallbackEnd);
    if (!end) return null;

    const diffMs = end.getTime() - start.getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return 0;
    return diffMs / (1000 * 60 * 60);
}

function isOpenShiftOvertime(record, referenceTime = new Date()) {
    const hasTimeOut = !!parseDate(record.timeOut);
    if (hasTimeOut) return false;

    const workedHours = calculateWorkedHours(record, referenceTime);
    return workedHours !== null && workedHours > 9;
}

function calculateAttendanceStatus(record, leaveRequests, overtimeRequests = []) {
    if (record.status) return record.status;

    const dateObj = parseDate(record.timeIn) || parseDate(record.timestamp) || parseDate(record.date);
    if (!dateObj) return 'Absent';

    const recordDateStart = startOfDay(dateObj);

    const isOnLeave = leaveRequests.some(leave => {
        const idMatch = leave.employeeId === (record.employeeId || record.userId);
        if (leave.status !== 'Approved' || !idMatch) return false;

        let start = parseDate(leave.startDate);
        let end = parseDate(leave.endDate);
        const leaveStart = startOfDay(start);
        const leaveEnd = startOfDay(end);

        return leaveStart && leaveEnd && recordDateStart >= leaveStart && recordDateStart <= leaveEnd;
    });

    if (isOnLeave) return 'On Leave';
    return 'Absent';
}

exports.dashboard = async (req, res) => {
    const [
        currentAdmin,
        overtimeRequests,
        users,
        leaveRequests,
        allAttendance,
        payrollList,
        allHolidays,
        logsSnapshot,
        eventsSnapshot
    ] = await Promise.all([
        req.session && req.session.user ? userModel.getUserById(req.session.user.uid) : Promise.resolve(null),
        overtimeModel.getAll(),
        userModel.getEmployeeUsers(),
        leaveModel.getAll(),
        attendanceModel.getAllAttendance(),
        payrollModel.getAllPayroll(),
        holidayModel.getAll(),
        db.collection('logs').get(),
        db.collection('events_announcements').orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ docs: [] }))
    ]);

    const allEventsData = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const dashboardEvents = allEventsData.filter(e => e.type === 'Event').slice(0, 5);
    const dashboardAnnouncements = allEventsData.filter(e => e.type === 'Announcement').slice(0, 5);

    // --- DEDUPLICATION LOGIC ---
    // Filter out duplicate attendance records (same user, within 60 seconds)
    // Keeps the newest record of a burst.
    const uniqueAttendance = [];
    const lastRecordByUser = new Map(); // userId -> timestamp

    for (const record of allAttendance) {
        const userId = record.employeeId || record.userId;
        const ts = parseDate(record.timestamp || record.timeIn);

        if (userId && ts) {
            if (lastRecordByUser.has(userId)) {
                const lastTs = lastRecordByUser.get(userId);
                // If within 60 seconds of the previous (newer) record, skip
                if (Math.abs(lastTs - ts) < 60000) continue;
            }
            lastRecordByUser.set(userId, ts);
        }
        uniqueAttendance.push(record);
    }

    const userMap = new Map(users.map(u => [u.id, u]));

    // --- Create a unified Recent Activity feed ---
    // 1. Get attendance activity (use unique list)
    const attendanceActivity = uniqueAttendance.map(record => {
        const user = userMap.get(record.employeeId || record.userId);
        const statusLabel = record.status || (record.timeOut ? 'Timed Out' : 'Timed In');
        return {
            type: statusLabel,
            name: (user && user.name) ? user.name : (record.employeeName || 'Unknown'),
            timestamp: parseDate(record.timestamp || record.timeIn),
            photoUrl: user ? user.photoUrl : null,
        };
    }).filter(activity => activity.timestamp);

    // 2. Get log activity (leave/overtime approvals/rejections)
    const logActivity = [];
    logsSnapshot.forEach(doc => {
        const data = doc.data();
        const user = userMap.get(data.employeeId);
        logActivity.push({
            type: data.action, // e.g., 'Leave Approved'
            name: (user && user.name) ? user.name : (data.employeeName || 'Unknown'),
            timestamp: parseDate(data.timestamp),
            photoUrl: user ? user.photoUrl : null,
        });
    });

    // 3. Combine, sort, and format for the view
    const combinedActivity = [...attendanceActivity, ...logActivity]
        .filter(a => a.timestamp) // Ensure there's a timestamp to sort by
        .sort((a, b) => b.timestamp - a.timestamp);

    const recentActivity = combinedActivity.slice(0, 15).map(activity => ({
        ...activity,
        date: formatDate(activity.timestamp),
        timeIn: formatTime(activity.timestamp), // Use timeIn for display consistency
    }));

    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todaysAttendanceMap = new Map();

    uniqueAttendance.forEach(record => {
        const recordDate = parseDate(record.timestamp || record.timeIn);
        if (recordDate && recordDate.getFullYear() === today.getFullYear() &&
            recordDate.getMonth() === today.getMonth() &&
            recordDate.getDate() === today.getDate()) {
            todaysAttendanceMap.set(record.employeeId || record.userId, record);
        }
    });

    const employeeStatusList = users.map(user => {
        const attendanceRecord = todaysAttendanceMap.get(user.id);
        const recordForStatus = attendanceRecord || {
            employeeId: user.id,
            userId: user.id,
            timeIn: null,
            timeOut: null,
            timestamp: todayStart
        };
        let status = calculateAttendanceStatus(recordForStatus, leaveRequests, overtimeRequests);
        if (attendanceRecord && isOpenShiftOvertime(attendanceRecord)) {
            status = 'Overtime';
        }
        if (user.status === 'Suspended') {
            status = 'Suspended';
        } else if (user.status === 'Inactive') {
            status = 'Inactive';
        }
        return {
            id: user.id,
            name: user.name || user.email,
            photoUrl: user.photoUrl,
            status: status
        };
    });

    const attendanceOverviewData = { present: 0, active: 0, late: 0, absent: 0 };
    employeeStatusList.forEach(employee => {
        if (employee.status === 'Timed In') attendanceOverviewData.active++;
        else if (employee.status === 'Overtime') attendanceOverviewData.active++;
        if (employee.status === 'Present') attendanceOverviewData.present++;
        else if (employee.status === 'Active') attendanceOverviewData.active++;
        else if (employee.status === 'Late') attendanceOverviewData.late++;
        else if (['Absent', 'Suspended', 'Inactive'].includes(employee.status)) attendanceOverviewData.absent++;
    });

    const suspendedEmployees = users.filter(user =>
        String(user.status || '').toLowerCase() === 'suspended'
    ).length;

    // Calculate payroll metrics for the analytics chart
    const payrollMetrics = payrollList.reduce((acc, p) => {
        let val = getNumericValue(getFirstDefinedValue(
            p.netPay, p.netpay, p.net_pay, p.totalSalary, p.total_salary, p.amount, p.salary, 0
        ));

        // Fallback: Kung walang explicit netPay field (halimbawa pagkatapos i-edit), 
        // i-calculate natin mula sa breakdown fields.
        if (val === 0) {
            const basic = getNumericValue(p.basic);
            const bonus = getNumericValue(p.bonus);
            const deductions = getNumericValue(p.deductions);
            if (basic !== 0 || bonus !== 0 || deductions !== 0) {
                val = basic + bonus - deductions;
            }
        }

        const status = (p.status || 'Pending').toLowerCase();
        if (status === 'processed') {
            acc.processed += val;
        } else {
            acc.pending += val;
        }
        acc.total += val;
        return acc;
    }, { processed: 0, pending: 0, total: 0 });

    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const todayForHolidays = new Date(now);
    todayForHolidays.setHours(0, 0, 0, 0);

    const monthlyHolidays = allHolidays
        .map(holiday => {
            const parsedDate = parseDate(holiday.date);
            if (!parsedDate) return null;
            const holidayDay = new Date(parsedDate);
            holidayDay.setHours(0, 0, 0, 0);

            let statusLabel = 'Upcoming';
            if (holidayDay.getTime() < todayForHolidays.getTime()) {
                statusLabel = 'Finished';
            } else if (holidayDay.getTime() === todayForHolidays.getTime()) {
                statusLabel = 'Today';
            }

            return {
                ...holiday,
                date: parsedDate,
                statusLabel,
                isFinished: statusLabel === 'Finished',
                monthLabel: parsedDate.toLocaleDateString('en-US', { timeZone: APP_TIMEZONE, month: 'short' }).toUpperCase(),
                dayLabel: parsedDate.getDate().toString().padStart(2, '0'),
                fullDateLabel: parsedDate.toLocaleDateString('en-US', {
                    timeZone: APP_TIMEZONE,
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
            };
        })
        .filter(holiday => holiday && holiday.date >= currentMonthStart && holiday.date <= currentMonthEnd)
        .sort((a, b) => a.date - b.date);

    const weeklyLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayToIndexMap = {
        1: 0,
        2: 1,
        3: 2,
        4: 3,
        5: 4,
        6: 5,
        0: 6
    };
    const overtimeHoursByDay = [0, 0, 0, 0, 0, 0, 0];

    overtimeRequests.forEach((request) => {
        const requestDate = parseDate(request._sortDate || request.actionDate || request.requestedDate || request.date);
        if (!requestDate) return;

        const hours = getNumericValue(request.hours);
        const dayIndex = dayToIndexMap[requestDate.getDay()];
        if (dayIndex === undefined) return;

        overtimeHoursByDay[dayIndex] += hours;
    });

    const dashboardCharts = {
        attendance: {
            labels: ['Present', 'Active', 'Late', 'Absent'],
            values: [
                attendanceOverviewData.present || 0,
                attendanceOverviewData.active || 0,
                attendanceOverviewData.late || 0,
                attendanceOverviewData.absent || 0
            ]
        },
        overtime: {
            labels: weeklyLabels,
            values: overtimeHoursByDay.map(value => Number(value.toFixed(2)))
        }
    };

    res.render("dashboard", {
        currentAdmin: currentAdmin || req.session.user || null,
        overtimeRequests,
        totalEmployees: users.length,
        suspendedEmployees,
        leaveRequests,
        recentActivity,
        payrollList, // Pass the original payrollList, as it should already contain netPay from the database
        payrollMetrics,
        totalNetPay: payrollMetrics.total,
        holidays: monthlyHolidays,
        holidayMonthLabel: currentMonthStart.toLocaleDateString('en-US', {
            timeZone: APP_TIMEZONE,
            month: 'long',
            year: 'numeric'
        }),
        dashboardCharts,
        employeeStatusList,
        attendanceOverviewData,
        events: dashboardEvents,
        announcements: dashboardAnnouncements
    });
};

exports.addAttendancePage = (req, res) => {
    res.render('attendance', { title: 'Add Attendance' });
};

exports.storeAttendance = async (req, res) => {
    try {
        const users = await userModel.getEmployeeUsers();
        const normalized = normalizeManualAttendanceForm(req.body, {}, users);
        if (normalized.errors.length) {
            req.flash('error', normalized.errors[0]);
            return res.redirect('/attendance/add');
        }

        await attendanceModel.addAttendance(normalized.data);
        req.flash('success', 'Attendance record added successfully.');
    } catch (error) {
        console.error('Error adding attendance record:', error);
        req.flash('error', 'Failed to add attendance record.');
    }
    res.redirect('/attendance-monitor');
};

exports.editAttendancePage = async (req, res) => {
    try {
        const attendance = await attendanceModel.getAttendanceById(req.params.id);
        if (!attendance) {
            req.flash('error', 'Attendance record not found.');
            return res.redirect('/attendance-monitor');
        }

        res.render('attendance', {
            title: 'Edit Attendance',
            attendance,
            formAction: `/attendance/edit/${attendance.id}`,
            submitLabel: 'UPDATE ATTENDANCE',
            isEditMode: true,
            formValues: {
                employeeName: attendance.employeeName || attendance.name || '',
                date: formatDateForInput(attendance.date || attendance.timestamp || attendance.timeIn),
                timeIn: formatTimeForInput(attendance.timeIn),
                timeOut: formatTimeForInput(attendance.timeOut),
                location: attendance.location || attendance.coords?.address || ''
            }
        });
    } catch (error) {
        console.error('Error loading attendance edit page:', error);
        req.flash('error', 'Failed to load attendance record.');
        res.redirect('/attendance-monitor');
    }
};

exports.updateAttendance = async (req, res) => {
    try {
        const existing = await attendanceModel.getAttendanceById(req.params.id);
        if (!existing) {
            req.flash('error', 'Attendance record not found.');
            return res.redirect('/attendance-monitor');
        }

        const users = await userModel.getEmployeeUsers();
        const normalized = normalizeManualAttendanceForm(req.body, existing, users);
        if (normalized.errors.length) {
            req.flash('error', normalized.errors[0]);
            return res.redirect(`/attendance/edit/${req.params.id}`);
        }

        const updatedData = {
            ...existing,
            ...normalized.data
        };

        const updated = await attendanceModel.updateAttendance(req.params.id, updatedData);
        if (!updated) {
            req.flash('error', 'Failed to update attendance record.');
            return res.redirect('/attendance-monitor');
        }

        req.flash('success', 'Attendance record updated successfully.');
    } catch (error) {
        console.error('Error updating attendance record:', error);
        req.flash('error', 'Failed to update attendance record.');
    }

    res.redirect('/attendance-monitor');
};

exports.deleteAttendance = async (req, res) => {
    try {
        const deleted = await attendanceModel.deleteAttendance(req.params.id);
        req.flash(
            deleted ? 'success' : 'error',
            deleted ? 'Attendance record deleted successfully.' : 'Failed to delete attendance record.'
        );
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        req.flash('error', 'Failed to delete attendance record.');
    }

    res.redirect('/attendance-monitor');
};

exports.attendanceMonitor = async (req, res) => {
    const [attendance, users, leaveRequests, overtimeRequests] = await Promise.all([
        attendanceModel.getAllAttendance(),
        userModel.getEmployeeUsers(),
        leaveModel.getAll(),
        overtimeModel.getAll()
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));

    // --- DEDUPLICATION LOGIC FOR MONITOR ---
    const uniqueAttendance = [];
    const lastRecordByUser = new Map();

    for (const record of attendance) {
        const userId = record.employeeId || record.userId;
        const ts = parseDate(record.timestamp || record.timeIn);

        if (userId && ts) {
            if (lastRecordByUser.has(userId)) {
                const lastTs = lastRecordByUser.get(userId);
                if (Math.abs(lastTs - ts) < 60000) continue;
            }
            lastRecordByUser.set(userId, ts);
        }
        uniqueAttendance.push(record);
    }

    const attendanceWithStatus = await Promise.all(uniqueAttendance.map(async record => {
        let dailyStatus = 'Present';
        const empId = record.employeeId || record.userId;
        const user = userMap.get(empId);
        const employeeName = (user && user.name) ? user.name : (record.employeeName || record.name || 'Unknown');
        const now = new Date();

        // 1. Calculate Late (Assume 8:00 AM shift start)
        const timeInDate = parseDate(record.timeIn);
        if (timeInDate) {
            const shiftStart = new Date(timeInDate);
            shiftStart.setHours(8, 0, 0, 0);
            if (timeInDate > shiftStart) dailyStatus = 'Late';
        }

        // 2. Check Overtime (> 9 Hours)
        let hoursWorked = '-';
        const start = parseDate(record.timeIn);
        const end = parseDate(record.timeOut);
        const openShiftOvertime = isOpenShiftOvertime(record, now);

        if (start && end) {
            const diff = end.getTime() - start.getTime();
            const hours = diff / (1000 * 60 * 60);
            hoursWorked = hours.toFixed(2) + ' hrs';

            if (hours > 9) {
                dailyStatus = 'Overtime';
                // Auto-add to overtime collection if not already there
                // NOTE: Logic to update database or add overtime entries moved to the Clock-Out event
                // to prevent GET request timeouts on Vercel.
            }
        } else if (start && openShiftOvertime) {
            const hours = calculateWorkedHours(record, now) || 0;
            hoursWorked = hours.toFixed(2) + ' hrs';
            dailyStatus = 'Overtime';

        }

        // 3. Check Leave
        let status = calculateAttendanceStatus(record, leaveRequests, overtimeRequests);
        if (status === 'On Leave') dailyStatus = 'On Leave';
        if (status === 'Absent') dailyStatus = 'Absent';
        if (openShiftOvertime) {
            status = 'Overtime';
            dailyStatus = 'Overtime';
        }

        return {
            ...record,
            name: employeeName,
            photoUrl: user ? user.photoUrl : null,
            date: formatDate(record.timestamp || record.timeIn),
            timeIn: formatTime(record.timeIn),
            timeOut: formatTime(record.timeOut),
            status,
            dailyStatus,
            hoursWorked
        };
    }));

    // Filter by query parameters: prefer employeeId for exact matches, fall back to search
    let filteredAttendance = attendanceWithStatus;
    if (req.query.employeeId) {
        const empId = String(req.query.employeeId || '').trim().toLowerCase();
        if (empId) {
            filteredAttendance = attendanceWithStatus.filter(record => {
                const rEmpId = String(record.employeeId || record.userId || '').trim().toLowerCase();
                return rEmpId && rEmpId === empId;
            });
        }
    } else if (req.query.search) {
        const searchTerm = String(req.query.search || '').toLowerCase().trim();
        filteredAttendance = attendanceWithStatus.filter(record =>
            (record.name && String(record.name).toLowerCase().includes(searchTerm)) ||
            (record.date && String(record.date).toLowerCase().includes(searchTerm))
        );
    }

    res.render("attendance-monitor", {
        attendance: filteredAttendance,
        users,
        leaveRequests,
        overtimeRequests
    });
};

exports.deviceRecognition = async (req, res) => {
    try {
        const usersPromise = userModel.getEmployeeUsers();
        let attendanceSnap;

        try {
            // Primary path: newest-first, so fresh login events always appear.
            attendanceSnap = await db.collection('attendance')
                .orderBy('timestamp', 'desc')
                .limit(5000)
                .get();
        } catch (queryError) {
            // Fallback path when ordering fails on legacy/missing timestamp records.
            console.warn('[DEVICE RECOGNITION] Ordered query failed, falling back to unordered fetch:', queryError.message);
            attendanceSnap = await db.collection('attendance').limit(5000).get();
        }

        const users = await usersPromise;

        const userMap = new Map(users.map(u => [String(u.id || u.uid || '').trim(), u]));

        const devices = attendanceSnap.docs
            .map(doc => {
                const record = doc.data();
                const coords = record.coords || {};

                const content =
                    coords.deviceUsed ||
                    coords.deviceUsage ||
                    record.deviceUsed ||
                    record.deviceUsage ||
                    record.deviceSerial ||
                    record.hardwareSerial ||
                    record.lastLoginDevice ||
                    'Unknown';

                const displayContent = String(content || 'Unknown').trim() || 'Unknown';

                const timestamp = parseDate(record.timestamp || record.timeIn || record.date || doc.createTime);
                if (!timestamp) return null;

                const userId = String(coords.employeeId || record.employeeId || record.userId || '').trim();
                const user = userMap.get(userId);
                const name =
                    (user && user.name) ||
                    coords.employeeName ||
                    record.employeeName ||
                    record.name ||
                    'Unknown Employee';

                return {
                    id: doc.id,
                    name,
                    deviceUsed: displayContent,
                    deviceUsage: displayContent,
                    hardwareSerial: displayContent,
                    deviceName: record.deviceName || 'Device',
                    timestamp,
                    date: formatDate(timestamp) || 'N/A',
                    time: formatTime(timestamp) || 'N/A'
                };
            })
            .filter(d => d !== null)
            .sort((a, b) => b.timestamp - a.timestamp);

        res.render("device-recognition", { devices });
    } catch (error) {
        console.error("[DEVICE RECOGNITION] Error:", error);
        res.status(500).send("Error loading device recognition data.");
    }
};

exports.imageRecognition = async (req, res) => {
    try {
        const usersPromise = userModel.getEmployeeUsers();
        const attendanceDocs = await fetchAttendanceDocsForImageRecognition();

        const users = await usersPromise;

        const capturesByEmployee = new Map(); // employeeId -> Map<photoKey, photo>
        const employeeMetaById = new Map();
        attendanceDocs.forEach(doc => {
            const data = doc.data() || {};
            const coords = data.coords || {};
            const empId = String(data.employeeId || data.userId || coords.employeeId || coords.userId || '').trim();
            if (!empId) return;

            const photoSources = extractNormalizedImageSourcesFromRecord(data, [
                data.verification_photo,
                data.verificationPhoto,
                data.photoUrl,
                data.profileImage,
                data.img_url,
                data.imgUrl,
                data.image_url,
                data['img url'],
                data.image,
                data.imageUrl,
                data.url,
                data.capturedImage,
                coords.verification_photo,
                coords.verificationPhoto,
                coords.photoUrl,
                coords.profileImage,
                coords.img_url,
                coords.imgUrl,
                coords.image_url,
                coords['img url'],
                coords.image,
                coords.imageUrl,
                coords.url
            ]);
            if (!photoSources.length) return;

            const ts = parseDate(data.timestamp || data.timeIn || data.date || doc.createTime);
            const label = ts
                ? `Verification - ${formatDate(ts)} ${formatTime(ts)}`
                : 'Verification';
            const employeeName = String(
                data.employeeName ||
                data.name ||
                coords.employeeName ||
                coords.name ||
                'Unknown Employee'
            ).trim() || 'Unknown Employee';

            if (!employeeMetaById.has(empId)) {
                employeeMetaById.set(empId, {
                    employeeId: empId,
                    name: employeeName
                });
            }

            if (!capturesByEmployee.has(empId)) {
                capturesByEmployee.set(empId, new Map());
            }

            const employeePhotoMap = capturesByEmployee.get(empId);

            photoSources.forEach((photoUrl) => {
                const photo = {
                    path: photoUrl,
                    label,
                    id: doc.id,
                    timestamp: ts,
                    sources: [photoUrl]
                };
                upsertPhoto(employeePhotoMap, photo, buildPhotoKey(photo));
            });
        });

        const seenEmployeeIds = new Set();
        const usersWithGallery = users.map(user => {
            const localImages = getLocalEmployeeImages({ userId: user.id, name: user.name });
            const photoMap = new Map();
            const candidateEmployeeIds = [
                user.id,
                user.uid,
                user.employeeId,
                user.employeeCode
            ]
                .map(value => String(value || '').trim())
                .filter((value, index, list) => value && list.indexOf(value) === index);

            const profileSources = buildUserProfileSources(user, localImages.profile);

            if (profileSources.length) {
                upsertPhoto(photoMap, {
                    path: profileSources.find(source => localImageExists(source)) || profileSources[0],
                    label: 'Current Profile',
                    sources: profileSources
                });
            }

            localImages.captures.forEach((photo) => {
                if (localImageExists(photo.path)) {
                    upsertPhoto(photoMap, {
                        ...photo,
                        sources: [photo.path]
                    });
                }
            });

            candidateEmployeeIds.forEach((candidateId) => {
                seenEmployeeIds.add(candidateId);
                const employeeRemotePhotos = capturesByEmployee.get(candidateId) || new Map();
                employeeRemotePhotos.forEach((photo) => {
                    const key = buildPhotoKey(photo);
                    upsertPhoto(photoMap, {
                        ...photo,
                        sources: Array.isArray(photo.sources) && photo.sources.length ? photo.sources : [photo.path]
                    }, key);
                });
            });

            const uniquePhotos = Array.from(photoMap.entries())
                .map(([photoKey, photo]) => ({ ...photo, photoKey }))
                .filter(photo => photo.path)
                .sort((a, b) => {
                    if (String(a.label).toLowerCase().includes('profile')) return -1;
                    if (String(b.label).toLowerCase().includes('profile')) return 1;
                    const aTime = a.timestamp ? parseDate(a.timestamp)?.getTime() || 0 : 0;
                    const bTime = b.timestamp ? parseDate(b.timestamp)?.getTime() || 0 : 0;
                    return bTime - aTime;
                });

            return { ...user, photos: uniquePhotos };
        });

        capturesByEmployee.forEach((photoMap, employeeId) => {
            if (seenEmployeeIds.has(employeeId)) return;

            const meta = employeeMetaById.get(employeeId) || {};
            const uniquePhotos = Array.from(photoMap.entries())
                .map(([photoKey, photo]) => ({ ...photo, photoKey }))
                .filter(photo => photo.path)
                .sort((a, b) => {
                    const aTime = a.timestamp ? parseDate(a.timestamp)?.getTime() || 0 : 0;
                    const bTime = b.timestamp ? parseDate(b.timestamp)?.getTime() || 0 : 0;
                    return bTime - aTime;
                });

            if (!uniquePhotos.length) return;

            usersWithGallery.push({
                id: employeeId,
                employeeId,
                name: meta.name || employeeId,
                role: 'Employee',
                photos: uniquePhotos
            });
        });

        usersWithGallery.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        res.render('image-recognition', { users: usersWithGallery });
    } catch (error) {
        console.error("[IMAGE RECOGNITION] Error:", error);
        res.status(500).send("Error loading image recognition data.");
    }
};

exports.attendanceSummaryEmployee = async (req, res) => {
    try {
        const empId = req.query.employeeId;
        if (!empId) {
            req.flash('error', 'Employee ID is required.');
            return res.redirect('/attendance-monitor');
        }

        const [attendance, users, leaveRequests, overtimeRequests] = await Promise.all([
            attendanceModel.getAllAttendance(),
            userModel.getEmployeeUsers(),
            leaveModel.getAll(),
            overtimeModel.getAll()
        ]);

        const user = users.find(u => String(u.id || u.uid) === String(empId));
        const employeeName = user ? user.name : 'Unknown Employee';

        const employeeRecords = attendance
            .filter(r => String(r.employeeId || r.userId) === String(empId))
            .sort((a, b) => (parseDate(b.timestamp || b.timeIn) || 0) - (parseDate(a.timestamp || a.timeIn) || 0));

        const uniqueRecords = [];
        let lastProcessedTs = null;

        for (const record of employeeRecords) {
            const ts = parseDate(record.timestamp || record.timeIn);
            if (ts && lastProcessedTs && Math.abs(lastProcessedTs - ts) < 60000) continue;
            uniqueRecords.push(record);
            lastProcessedTs = ts;
        }

        // ✅ FIXED DECLARATIONS
        let totalWorkingHours = 0;
        let totalOfficeHours = 0;
        let lateDaysCount = 0;
        let totalLateMins = 0;

        const uniqueDates = new Set();
        const lateDates = new Set();

        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const processedRecords = uniqueRecords.map(record => {
            const timeIn = parseDate(record.timeIn);
            let lateInfo = '-';

            if (timeIn) {
                const dateKey = timeIn.toDateString();

                if (!uniqueDates.has(dateKey)) {
                    uniqueDates.add(dateKey);
                    totalOfficeHours += 9; // ✅ only once per unique day
                }

                const shiftStart = new Date(timeIn);
                shiftStart.setHours(8, 0, 0, 0);

                if (timeIn > shiftStart) {
                    if (!lateDates.has(dateKey)) {
                        lateDates.add(dateKey);
                        lateDaysCount++;
                    }

                    const diffMins = Math.floor((timeIn - shiftStart) / 60000);
                    totalLateMins += diffMins;

                    const h = Math.floor(diffMins / 60);
                    const m = diffMins % 60;
                    lateInfo = h > 0 ? `${h}h ${m}m late` : `${m}m late`;
                }
            }

            const actualWorked = calculateWorkedHours(record) || 0;
            totalWorkingHours += actualWorked;

            return {
                ...record,
                date: formatDate(record.timestamp || record.timeIn),
                timeIn: formatTime(record.timeIn),
                timeOut: formatTime(record.timeOut),
                hoursWorked: actualWorked.toFixed(2) + ' hrs',
                lateInfo,
                status: calculateAttendanceStatus(record, leaveRequests, overtimeRequests)
            };
        });

        const presentDaysCount = uniqueDates.size;

        // ✅ FINAL CALCULATIONS
        const totalLateH = Math.floor(totalLateMins / 60);
        const totalLateM = totalLateMins % 60;
        const totalLateStr = totalLateH > 0 ? `${totalLateH}h ${totalLateM}m` : `${totalLateM}m`;

        const totalWorkingMins = Math.round(totalWorkingHours * 60);
        const workedH = Math.floor(totalWorkingMins / 60);
        const workedM = totalWorkingMins % 60;

        const workedPercent = totalOfficeHours > 0
            ? ((totalWorkingHours / totalOfficeHours) * 100).toFixed(2)
            : "0.00";

        res.render('attendance-summary-employee', {
            employeeName,
            totalOfficeTime: totalOfficeHours + ' hrs', // ✅ fixed duplicate
            totalWorkingTime: `${workedH} hrs ${workedM} mins (${workedPercent}%)`,
            presentDays: `${presentDaysCount} / ${daysInMonth} Days`,
            lateDays: `${lateDaysCount} Days (${totalLateStr})`,
            records: processedRecords
        });

    } catch (error) {
        console.error("[SUMMARY ERROR]:", error);
        res.status(500).send("Error generating employee attendance summary.");
    }
};
