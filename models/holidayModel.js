const { db } = require('../config/firebaseAdmin');

class Holiday {
    constructor(id, name, date, type) {
        this.id = id;
        this.name = name;
        this.date = date;
        this.type = type;
    }

    static async getAll() {
        try {
            const snapshot = await db.collection('holidays').get();
            if (snapshot.empty) {
                return [];
            }
            return snapshot.docs.map(doc => {
                const data = doc.data();
                let holidayDate = null;
                if (data.date) {
                    holidayDate = data.date.toDate ? data.date.toDate() : new Date(data.date);
                    if (isNaN(holidayDate.getTime())) holidayDate = null;
                }
                return new Holiday(doc.id, data.name, holidayDate, data.type);
            });
        } catch (error) {
            console.error("Error fetching holidays:", error);
            throw error;
        }
    }
}

module.exports = Holiday;
