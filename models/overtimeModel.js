const { db } = require('../config/firebaseAdmin');
const overtimeCollection = db.collection('overtime');

exports.getAll = async () => {
    try {
        // Fetch all without sorting first to avoid index errors
        const snapshot = await overtimeCollection.get();
        const requests = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Keep original date object for sorting
            const sortDate = data.date || data.timestamp || data.createdAt;
            if (data.date && data.date.toDate) {
                data.date = data.date.toDate().toLocaleDateString();
            }
            requests.push({ id: doc.id, ...data, _sortDate: sortDate });
        });

        // Sort in memory
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
        const docRef = await overtimeCollection.add(data);
        return { id: docRef.id, ...data };
    } catch (error) {
        console.error("Error adding overtime request:", error);
        throw error;
    }
};

exports.approve = async (id) => {
    try {
        const docRef = overtimeCollection.doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                status: 'Approved',
                actionDate: actionDate
            });

            await db.collection('logs').add({
                action: 'Overtime Approved',
                overtimeRequestId: id,
                employeeId: doc.data().employeeId,
                employeeName: doc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            return { id: doc.id, ...doc.data(), status: 'Approved' };
        }
        return null;
    } catch (error) {
        console.error("Error approving overtime:", error);
        throw error;
    }
};

exports.reject = async (id) => {
    try {
        const docRef = overtimeCollection.doc(id);
        const doc = await docRef.get();
        if (doc.exists) {
            const actionDate = new Date();
            await docRef.update({
                status: 'Rejected',
                actionDate: actionDate
            });

            await db.collection('logs').add({
                action: 'Overtime Rejected',
                overtimeRequestId: id,
                employeeId: doc.data().employeeId,
                employeeName: doc.data().employeeName || 'Unknown',
                timestamp: actionDate
            });
            return { id: doc.id, ...doc.data(), status: 'Rejected' };
        }
        return null;
    } catch (error) {
        console.error("Error rejecting overtime:", error);
        throw error;
    }
};