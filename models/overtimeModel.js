const { db, admin } = require('../config/firebaseAdmin');

function getOvertimeCollection() {
    if (!db) {
        throw new Error('Firestore is not initialized.');
    }

    return db.collection('overtime');
}

function isRequestedFlag(value) {
    return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function normalizeOvertimeStatus(data = {}) {
    const rawStatus = String(data.otStatus || data.status || '').trim().toLowerCase();

    if (rawStatus === 'approved') return 'Approved';
    if (rawStatus === 'rejected') return 'Rejected';
    if (rawStatus === 'pending approval' || rawStatus === 'pending') return 'Pending Approval';
    if (rawStatus === 'ot') return 'Pending Approval';
    if (isRequestedFlag(data.isOTRequested)) return 'Pending Approval';

    return '';
}

function formatDateValue(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') {
        return value.toDate().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString('en-US', { timeZone: 'Asia/Manila' });
}

function formatDisplayDate(value) {
    if (!value) return null;
    try {
        const parsed = value.toDate ? value.toDate() : new Date(value);
        return Number.isNaN(parsed.getTime())
            ? String(value)
            : parsed.toLocaleDateString('en-US', {
                timeZone: 'Asia/Manila',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
    } catch (error) {
        return String(value);
    }
}

function getOvertimeDateSource(data = {}) {
    return data.timeIn || data.timestamp || data.requestedDate || data.createdAt || data.date || data._ts || null;
}

exports.getAll = async () => {
    try {
        const overtimeCollection = getOvertimeCollection();
        const allDocs = [];
        
        // 1. Fetch from manual overtime collection
        try {
            const otSnapshot = await overtimeCollection.get();
            allDocs.push(...otSnapshot.docs);
        } catch (err) {
            console.error("[OVERTIME MODEL] Failed to fetch manual overtime collection:", err.message);
        }

        // 2. Fetch from attendance collection where OT is flagged
        try {
            // Try multiple variants of the query (Boolean and String) to find every single request
            const queries = [
                db.collection('attendance').where('isOTRequested', '==', true).get(),
                db.collection('attendance').where('isOTRequested', '==', 'true').get(),
                db.collection('attendance').where('otStatus', '==', 'Pending Approval').get(),
                db.collection('attendance').where('otStatus', '==', 'Pending').get(),
                db.collection('attendance').where('otStatus', '==', 'Approved').get(),
                db.collection('attendance').where('otStatus', '==', 'Rejected').get(),
                db.collection('attendance').where('status', '==', 'OT').get()
            ];
            
            const results = await Promise.all(queries);
            results.forEach(snap => {
                snap.docs.forEach(doc => {
                    if (!allDocs.some(d => d.id === doc.id)) allDocs.push(doc);
                });
            });
        } catch (err) {
            console.warn("[OVERTIME MODEL] Optimized query failed. Performing manual scan of attendance...");
            // FAIL-SAFE: If indices are missing, manually filter to ensure no request is missed.
            const fallbackSnapshot = await db.collection('attendance').get();
            fallbackSnapshot.docs.forEach(doc => {
                const data = doc.data() || {};
                const normalizedStatus = normalizeOvertimeStatus(data);
                if ((isRequestedFlag(data.isOTRequested) || normalizedStatus) && !allDocs.some(d => d.id === doc.id)) {
                    allDocs.push(doc);
                }
            });
        }

        const requests = [];

        allDocs.forEach(doc => {
            const data = doc.data() || {};
            const id = doc.id;
            const normalizedStatus = normalizeOvertimeStatus(data);
            if (!normalizedStatus) return;
            // Keep original date object for sorting (overtime occurrence date or fallback to timestamp)
            const sortDate = getOvertimeDateSource(data);

            // Normalize displayed fields
            const dateSource = getOvertimeDateSource(data);
            const displayDate = formatDisplayDate(dateSource);

            // Ensure requestedDate doesn't fall back to null if timestamp exists
            const requestedDate = formatDateValue(data.requestedDate || data.requestedAt || data.createdAt || data.timestamp || data._ts);
            const actionDate = formatDateValue(data.actionDate || data.approvedAt || data.rejectedAt || null);

            // Build a readable history array (if any)
            const rawHistory = Array.isArray(data.history) ? data.history : (Array.isArray(data.logs) ? data.logs : []);
            const history = (rawHistory || []).map(h => ({
                action: h.action || h.type || 'Event',
                by: h.by || h.user || null,
                name: h.name || h.byName || null,
                note: h.note || null,
                timestamp: formatDateValue(h.timestamp || h.at || h.when || null)
            }));

            requests.push({
                ...data,
                id: id,
                sourceCollection: doc.ref.parent && doc.ref.parent.id ? doc.ref.parent.id : 'unknown',
                employee: data.employeeName || data.name || data.employee || data.employeeId || 'Unknown',
                employeeId: data.employeeId || data.userId || id,
                // Attendance punch status (Timed In / Timed Out)
                attendanceStatus: data.status || 'N/A',
                status: normalizedStatus,
                otStatus: normalizedStatus,
                hours: data.otHours || data.hours || data.totalHours || data.workHours || 'N/A',
                reason: data.reason || data.otReason || data.remarks || data.note || data.attendanceStatus || 'OT request from attendance log',
                date: displayDate || 'N/A',
                requestedDate: requestedDate,
                actionDate: actionDate,
                history,
                _sortDate: sortDate
            });
        });
        
        // Smart De-duplication: If the same employee has an OT request on the same date, keep the one with a valid status
        const uniqueMap = new Map();
        
        requests.forEach(req => {
            // Create a unique key based on Employee and the specific Date of the request
            const key = `${String(req.employeeId).trim()}_${req.date}`;
            if (!uniqueMap.has(key) || (req.otStatus !== 'Pending Approval' && uniqueMap.get(key).otStatus === 'Pending Approval')) {
                uniqueMap.set(key, req);
            }
        });

        const sortedRequests = Array.from(uniqueMap.values()).sort((a, b) => {
            const dateA = a._sortDate && a._sortDate.toDate ? a._sortDate.toDate() : new Date(a._sortDate || 0);
            const dateB = b._sortDate && b._sortDate.toDate ? b._sortDate.toDate() : new Date(b._sortDate || 0);
            return dateB - dateA;
        });
        return sortedRequests;
    } catch (error) {
        console.error("Error fetching overtime requests:", error);
        return []; // Return empty array on error so dashboard doesn't crash
    }
};

exports.add = async (data) => {
    try {
        const overtimeCollection = getOvertimeCollection();
        const now = new Date();
        const payload = {
            ...data,
            isOTRequested: true,
            otStatus: data.otStatus || 'Pending Approval',
            requestedDate: data.requestedDate || now,
            createdAt: data.createdAt || now,
            // Initial history entry for request
            history: Array.isArray(data.history) && data.history.length ? data.history : [
                {
                    action: 'Requested',
                    by: data.requestedBy || data.employeeId || null,
                    name: data.requestedByName || data.employeeName || null,
                    timestamp: now
                }
            ]
        };
        const docRef = await overtimeCollection.add(payload);
        return { id: docRef.id, ...payload };
    } catch (error) {
        console.error("Error adding overtime request:", error);
        throw error;
    }
};

exports.approve = async (id, performedBy = {}) => {
    try {
        const overtimeCollection = getOvertimeCollection();
        // Try to find the document in 'overtime' first, then 'attendance'
        let docRef = overtimeCollection.doc(id);
        let doc = await docRef.get();

        if (!doc.exists) {
            docRef = db.collection('attendance').doc(id);
            doc = await docRef.get();
        }

        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                isOTRequested: false,
                otStatus: 'Approved',
                actionDate: actionDate,
                approvedAt: actionDate,
                history: admin.firestore.FieldValue.arrayUnion({
                    action: 'Approved',
                    by: performedBy && (performedBy.id || performedBy.uid) || null,
                    name: performedBy && (performedBy.name || performedBy.email) || null,
                    timestamp: actionDate
                })
            });

            await db.collection('logs').add({
                action: 'Overtime Approved',
                overtimeRequestId: id,
                employeeId: doc.data().employeeId,
                employeeName: doc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            const updated = await docRef.get();
            return { id: updated.id, ...updated.data() };
        }
        return null;
    } catch (error) {
        console.error("Error approving overtime:", error);
        throw error;
    }
};

exports.reject = async (id, performedBy = {}) => {
    try {
        const overtimeCollection = getOvertimeCollection();
        // Try to find the document in 'overtime' first, then 'attendance'
        let docRef = overtimeCollection.doc(id);
        let doc = await docRef.get();

        if (!doc.exists) {
            docRef = db.collection('attendance').doc(id);
            doc = await docRef.get();
        }

        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                isOTRequested: false,
                otStatus: 'Rejected',
                actionDate: actionDate,
                rejectedAt: actionDate,
                history: admin.firestore.FieldValue.arrayUnion({
                    action: 'Rejected',
                    by: performedBy && (performedBy.id || performedBy.uid) || null,
                    name: performedBy && (performedBy.name || performedBy.email) || null,
                    timestamp: actionDate
                })
            });

            await db.collection('logs').add({
                action: 'Overtime Rejected',
                overtimeRequestId: id,
                employeeId: doc.data().employeeId,
                employeeName: doc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            const updated = await docRef.get();
            return { id: updated.id, ...updated.data() };
        }
        return null;
    } catch (error) {
        console.error("Error rejecting overtime:", error);
        throw error;
    }
};
