const { db } = require('../config/firebaseAdmin');
const userModel = require('./userModel');
const APP_TIMEZONE = 'Asia/Manila';

function toValidDate(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') {
        const converted = value.toDate();
        return isNaN(converted.getTime()) ? null : converted;
    }
    const converted = new Date(value);
    return isNaN(converted.getTime()) ? null : converted;
}

function formatDateTime(value) {
    const date = toValidDate(value);
    if (!date) return null;
    return date.toLocaleString('en-US', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
}

function firstValidDate(values) {
    for (const value of values) {
        const date = toValidDate(value);
        if (date) return date;
    }
    return null;
}

exports.getAll = async () => {
    try {
        // Fetch all employees via userModel to resolve profile images correctly
        const users = await userModel.getEmployeeUsers();
        const userMap = new Map(users.map(u => [u.id, u]));

        // Use collectionGroup to fetch 'leaves' from all employees (sub-collections)
        // Removed orderBy to prevent "FAILED_PRECONDITION" error (missing index)
        const snapshot = await db.collectionGroup('leaves').get();
        const requests = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const originalStartDate = data.startDate; // Keep raw date for sorting
            if (data.startDate && data.startDate.toDate) {
                data.startDate = data.startDate.toDate().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE });
            }
            if (data.endDate && data.endDate.toDate) {
                data.endDate = data.endDate.toDate().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE });
            }

            const requestDateSource = firstValidDate([
                data.requestDate,
                data.requestedDate,
                data.requestedAt,
                data.requested_on,
                data.createdAt,
                data.created_at,
                data.createdOn,
                data.timestamp,
                data.timestampRequested,
                data.appliedAt,
                data.submittedAt,
                data.submitted_at,
                data.dateRequested,
                doc.createTime,
                doc.updateTime,
                data.actionDate,
                originalStartDate,
                data.endDate
            ]);
            const formattedRequestedDate = formatDateTime(requestDateSource);

            let formattedActionDate = null;
            if (data.actionDate) {
                formattedActionDate = formatDateTime(data.actionDate);
            }

            // Ensure employeeId is captured from the parent document (the employee)
            const employeeId = data.employeeId || (doc.ref.parent.parent ? doc.ref.parent.parent.id : null);

            // Resolve employee name: Check leave doc first, then userMap, then fallback
            const userData = userMap.get(employeeId);
            const name = data.employeeName || data.name || (userData ? userData.name : 'Unknown Employee');
            const photoUrl = userData ? userData.photoUrl : null;

            requests.push({
                id: doc.id,
                employeeId,
                employeeName: name,
                photoUrl,
                ...data,
                requestedDate: formattedRequestedDate,
                actionDate: formattedActionDate,
                _sortDate: originalStartDate
            });
        });

        // Sort in memory
        requests.sort((a, b) => {
            const dateA = a._sortDate && a._sortDate.toDate ? a._sortDate.toDate() : new Date(a._sortDate || 0);
            const dateB = b._sortDate && b._sortDate.toDate ? b._sortDate.toDate() : new Date(b._sortDate || 0);
            return dateB - dateA;
        });

        return requests;
    } catch (error) {
        console.error("Error getting all leaves:", error);
        return [];
    }
};

exports.getPendingCount = async () => {
    // Removed where filter to prevent "FAILED_PRECONDITION" error
    const snapshot = await db.collectionGroup('leaves').get();
    let count = 0;
    snapshot.forEach(doc => {
        if (doc.data().status === 'Pending') count++;
    });
    return count;
};

exports.approve = async (id) => {
    try {
        // Find the document in the sub-collections
        // Using collectionGroup is necessary because we don't know the parent ID
        const snapshot = await db.collectionGroup('leaves').get();
        const targetDoc = snapshot.docs.find(doc => doc.id === id);

        if (targetDoc) {
            const actionDate = new Date();
            await targetDoc.ref.update({
                status: 'Approved',
                actionDate: actionDate
            });

            // Create a log entry for this action
            await db.collection('logs').add({
                action: 'Leave Approved',
                leaveRequestId: id,
                employeeId: targetDoc.data().employeeId,
                employeeName: targetDoc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error approving leave:", error);
        return false;
    }
};

exports.reject = async (id) => {
    try {
        const snapshot = await db.collectionGroup('leaves').get();
        const targetDoc = snapshot.docs.find(doc => doc.id === id);
        if (targetDoc) {
            const actionDate = new Date();
            await targetDoc.ref.update({
                status: 'Rejected',
                actionDate: actionDate
            });

            // Create a log entry for this action
            await db.collection('logs').add({
                action: 'Leave Rejected',
                leaveRequestId: id,
                employeeId: targetDoc.data().employeeId,
                employeeName: targetDoc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error rejecting leave:", error);
        return false;
    }
};

exports.delete = async (id) => {
    try {
        const snapshot = await db.collectionGroup('leaves').get();
        const targetDoc = snapshot.docs.find(doc => doc.id === id);
        if (targetDoc) {
            await targetDoc.ref.delete();
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error deleting leave:", error);
        return false;
    }
};
