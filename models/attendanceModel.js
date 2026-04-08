const { db } = require('../config/firebaseAdmin');
const attendanceCollection = db.collection('attendance');

exports.getAllAttendance = async () => {
    try {
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
    // Ensure both date and timestamp are saved for consistency
    const timestamp = new Date();
    const newRecord = {
        ...data,
        date: data.date ? new Date(data.date) : timestamp,
        timestamp: timestamp
    };
    const docRef = await attendanceCollection.add(newRecord);
    return { id: docRef.id, ...newRecord };
};