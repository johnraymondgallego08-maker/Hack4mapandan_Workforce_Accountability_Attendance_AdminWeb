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
            const databaseHolidays = snapshot.docs.map(doc => {
                const data = doc.data();
                let holidayDate = null;
                if (data.date) {
                    holidayDate = data.date.toDate ? data.date.toDate() : new Date(data.date);
                    if (isNaN(holidayDate.getTime())) holidayDate = null;
                }
                return new Holiday(doc.id, data.name, holidayDate, data.type);
            });
            return mergeHolidayLists(databaseHolidays, buildFallbackRegularHolidays());
        } catch (error) {
            console.error("Error fetching holidays:", error);
            return buildFallbackRegularHolidays();
        }
    }
}

function buildHolidayKey(holiday) {
    const dateValue = holiday && holiday.date instanceof Date && !isNaN(holiday.date.getTime())
        ? holiday.date.toISOString().slice(0, 10)
        : '';
    return `${String(holiday && holiday.name || '').trim().toLowerCase()}::${dateValue}`;
}

function mergeHolidayLists(primary = [], fallback = []) {
    const merged = new Map();
    [...fallback, ...primary].forEach((holiday) => {
        if (!holiday || !(holiday.date instanceof Date) || isNaN(holiday.date.getTime())) return;
        merged.set(buildHolidayKey(holiday), holiday);
    });
    return Array.from(merged.values()).sort((a, b) => a.date - b.date);
}

function getLastMondayOfAugust(year) {
    const date = new Date(year, 7, 31);
    while (date.getDay() !== 1) {
        date.setDate(date.getDate() - 1);
    }
    return date;
}

function getHolyWeekDates(year) {
    const knownDates = {
        2025: { maundyThursday: new Date(2025, 3, 17), goodFriday: new Date(2025, 3, 18) },
        2026: { maundyThursday: new Date(2026, 3, 2), goodFriday: new Date(2026, 3, 3) },
        2027: { maundyThursday: new Date(2027, 2, 25), goodFriday: new Date(2027, 2, 26) },
        2028: { maundyThursday: new Date(2028, 3, 13), goodFriday: new Date(2028, 3, 14) }
    };

    return knownDates[year] || null;
}

function buildFallbackRegularHolidays() {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];
    const holidays = [];

    years.forEach((year) => {
        const holyWeek = getHolyWeekDates(year);
        if (holyWeek) {
            holidays.push(new Holiday(`fallback-${year}-maundy-thursday`, 'Maundy Thursday', holyWeek.maundyThursday, 'Regular Holiday'));
            holidays.push(new Holiday(`fallback-${year}-good-friday`, 'Good Friday', holyWeek.goodFriday, 'Regular Holiday'));
        }

        holidays.push(
            new Holiday(`fallback-${year}-new-year`, "New Year's Day", new Date(year, 0, 1), 'Regular Holiday'),
            new Holiday(`fallback-${year}-araw-ng-kagitingan`, 'Araw ng Kagitingan', new Date(year, 3, 9), 'Regular Holiday'),
            new Holiday(`fallback-${year}-labor-day`, 'Labor Day', new Date(year, 4, 1), 'Regular Holiday'),
            new Holiday(`fallback-${year}-independence-day`, 'Independence Day', new Date(year, 5, 12), 'Regular Holiday'),
            new Holiday(`fallback-${year}-national-heroes-day`, 'National Heroes Day', getLastMondayOfAugust(year), 'Regular Holiday'),
            new Holiday(`fallback-${year}-bonifacio-day`, 'Bonifacio Day', new Date(year, 10, 30), 'Regular Holiday'),
            new Holiday(`fallback-${year}-christmas-day`, 'Christmas Day', new Date(year, 11, 25), 'Regular Holiday'),
            new Holiday(`fallback-${year}-rizal-day`, 'Rizal Day', new Date(year, 11, 30), 'Regular Holiday')
        );
    });

    return holidays;
}

module.exports = Holiday;
