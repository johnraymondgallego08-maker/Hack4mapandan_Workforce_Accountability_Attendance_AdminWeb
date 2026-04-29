const { db } = require('../config/firebaseAdmin');

function getAttendanceCollection() {
    if (!db) {
        throw new Error('Firestore is not initialized.');
    }

    return db.collection('attendance');
}

exports.getAllAttendance = async () => {
    try {
        const attendanceCollection = getAttendanceCollection();
        // Changed orderBy to 'timestamp' to match your database structure
        const snapshot = await attendanceCollection.orderBy('timestamp', 'desc').get();
        const records = [];
        snapshot.forEach(doc => {
            const data = doc.data();

            // Ensure 'date' property exists for the frontend, using timestamp as fallback
            if (!data.date && data.timestamp) {
                data.date = data.timestamp;
            }

            // Convert Firestore Timestamps to JS Dates if they exist
            if (data.date && data.date.toDate) {
                data.date = data.date.toDate();
            }
            records.push({ id: doc.id, ...data });
        });
        return records;
    } catch (error) {
        console.error("Error getting attendance records:", error);
        return [];
    }
};

exports.addAttendance = async (data) => {
    const attendanceCollection = getAttendanceCollection();
    // Ensure both date and timestamp are saved for consistency while preserving manual log time.
    const timestamp = data.timestamp || data.timeIn || new Date();
    const newRecord = {
        ...data,
        date: data.date ? new Date(data.date) : timestamp,
        timestamp: timestamp
    };
    const docRef = await attendanceCollection.add(newRecord);
    return { id: docRef.id, ...newRecord };
};

exports.getAttendanceById = async (id) => {
    try {
        const doc = await getAttendanceCollection().doc(id).get();
        if (!doc.exists) {
            return null;
        }
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error("Error getting attendance record by ID:", error);
        return null;
    }
};

exports.updateAttendance = async (id, data) => {
    try {
        const attendanceCollection = getAttendanceCollection();
        await attendanceCollection.doc(id).update({
            ...data,
            updatedAt: new Date()
        });
        return true;
    } catch (error) {
        console.error("Error updating attendance record:", error);
        return false;
    }
};

exports.deleteAttendance = async (id) => {
    try {
        await getAttendanceCollection().doc(id).delete();
        return true;
    } catch (error) {
        console.error("Error deleting attendance record:", error);
        return false;
    }
};
