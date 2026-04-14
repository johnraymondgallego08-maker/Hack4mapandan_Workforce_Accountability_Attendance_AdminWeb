const { db, admin } = require('../config/firebaseAdmin');
const overtimeCollection = db.collection('overtime');

exports.getAll = async () => {
    try {
        // Fetch all without sorting first to avoid index errors
        const snapshot = await overtimeCollection.get();
        const requests = [];

        const formatDateValue = (v) => {
            if (!v) return null;
            if (v.toDate && typeof v.toDate === 'function') return v.toDate().toLocaleString();
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toLocaleString();
        };

        snapshot.forEach(doc => {
            const data = doc.data() || {};
            // Keep original date object for sorting (overtime occurrence date or fallback to timestamp)
            const sortDate = data.date || data.timestamp || data.createdAt || data.requestedDate;

            // Normalize displayed fields
            let displayDate = null;
            if (data.date) {
                if (data.date.toDate && typeof data.date.toDate === 'function') displayDate = data.date.toDate().toLocaleDateString();
                else displayDate = String(data.date);
            }

            const requestedDate = formatDateValue(data.requestedDate || data.requestedAt || data.createdAt || data.timestamp);
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
                id: doc.id,
                ...data,
                employee: data.employeeName || data.employee || data.employeeId || data.name || 'Unknown',
                date: displayDate || (data.date || 'N/A'),
                requestedDate: requestedDate,
                actionDate: actionDate,
                history,
                _sortDate: sortDate
            });
        });

        // Sort in memory by the chosen sortDate
        requests.sort((a, b) => {
            const dateA = a._sortDate && a._sortDate.toDate ? a._sortDate.toDate() : new Date(a._sortDate || 0);
            const dateB = b._sortDate && b._sortDate.toDate ? b._sortDate.toDate() : new Date(b._sortDate || 0);
            return dateB - dateA;
        });
        return requests;
    } catch (error) {
        console.error("Error fetching overtime requests:", error);
        return []; // Return empty array on error so dashboard doesn't crash
    }
};

exports.add = async (data) => {
    try {
        const now = new Date();
        const payload = {
            ...data,
            status: data.status || 'Pending',
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
        const docRef = overtimeCollection.doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                status: 'Approved',
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
        const docRef = overtimeCollection.doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                status: 'Rejected',
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