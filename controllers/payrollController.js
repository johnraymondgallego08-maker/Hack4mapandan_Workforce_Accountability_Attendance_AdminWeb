const payrollModel = require('../models/payrollModel');
const userModel = require('../models/userModel');
const attendanceModel = require('../models/attendanceModel');
const { db } = require('../config/firebaseAdmin');

// Helper to safely handle Firestore Timestamps or Strings
function parseDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') return dateInput.toDate();
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
}

// Helper to robustly parse numeric values, handling currency symbols
function getNumericValue(value) {
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$₱,\s]/g, ''); // Remove currency symbols and commas
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

function getPayrollAmountValue(record = {}) {
    return getNumericValue(getFirstDefinedValue(
        record.netPay,
        record.netpay,
        record.net_pay,
        record.totalSalary,
        record.total_salary,
        record.amount,
        record.salary,
        0
    ));
}

function buildPayrollKey(value) {
    return String(value || '').trim();
}

function buildPeriodRange(record, fallbackYear, fallbackMonth, fallbackPeriodIdx) {
    let start = parseDate(record.periodStart);
    let end = parseDate(record.periodEnd);

    if (!start || !end) {
        if (fallbackPeriodIdx === 1) {
            start = new Date(fallbackYear, fallbackMonth, 1);
            end = new Date(fallbackYear, fallbackMonth, 15, 23, 59, 59, 999);
        } else {
            start = new Date(fallbackYear, fallbackMonth, 16);
            end = new Date(fallbackYear, fallbackMonth + 1, 0, 23, 59, 59, 999);
        }
    }

    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);

    return { start, end };
}

function normalizeDailyLogEntries(record) {
    const candidateLists = [
        record && record.dailyHistory,
        record && record.dailyLogs,
        record && record.dailyComputation,
        record && record.dailySalaryLogs
    ];

    for (const list of candidateLists) {
        if (!Array.isArray(list) || !list.length) continue;

        const normalized = list
            .map(entry => {
                const dateObj = parseDate(entry.date || entry.day || entry.timestamp);
                const dateLabel = dateObj
                    ? dateObj.toLocaleDateString('en-US')
                    : (entry.date || entry.day || 'N/A');
                const hours = getNumericValue(entry.hours || entry.workHours || entry.totalHours || 0);
                const amount = getNumericValue(getFirstDefinedValue(
                    entry.amount,
                    entry.salary,
                    entry.dailyPay,
                    entry.pay,
                    0
                ));
                return {
                    date: String(dateLabel),
                    hours: Number(hours.toFixed(2)),
                    amount: Number(amount.toFixed(2))
                };
            })
            .filter(entry => entry.date && !Number.isNaN(entry.hours) && !Number.isNaN(entry.amount));

        if (normalized.length > 0) return normalized;
    }

    return [];
}

function hasStoredDailyLogs(record) {
    const candidateLists = [
        record && record.dailyHistory,
        record && record.dailyLogs,
        record && record.dailyComputation,
        record && record.dailySalaryLogs
    ];
    return candidateLists.some(list => Array.isArray(list) && list.length > 0);
}

function buildDailyHistory(record, attendanceRecords, user) {
    const normalizedFromPayrollDoc = normalizeDailyLogEntries(record);
    if (normalizedFromPayrollDoc.length > 0) {
        return normalizedFromPayrollDoc;
    }

    const identifierSet = new Set([
        buildPayrollKey(record.employeeId),
        buildPayrollKey(record.employeeCode),
        buildPayrollKey(user && (user.id || user.uid)),
        buildPayrollKey(user && user.employeeId)
    ].filter(Boolean));

    const nameSet = new Set([
        String(record.employeeName || '').trim().toLowerCase(),
        String(user && user.name ? user.name : '').trim().toLowerCase()
    ].filter(Boolean));

    if (!identifierSet.size && !nameSet.size) return [];

    const { start, end } = buildPeriodRange(record, record.year, record.month, record.pIdx);
    if (!start || !end) return [];

    const matchingAttendance = attendanceRecords
        .filter(entry => {
            const attendanceEmployeeId = buildPayrollKey(entry.employeeId || entry.userId);
            const timeIn = parseDate(entry.timeIn || entry.timestamp || entry.date);
            const attendanceName = String(entry.employeeName || entry.name || '').trim().toLowerCase();
            const idMatch = identifierSet.has(attendanceEmployeeId);
            const nameMatch = attendanceName && nameSet.has(attendanceName);
            return (idMatch || nameMatch) && timeIn && timeIn >= start && timeIn <= end;
        })
        .sort((a, b) => {
            const aDate = parseDate(a.timeIn || a.timestamp || a.date) || 0;
            const bDate = parseDate(b.timeIn || b.timestamp || b.date) || 0;
            return aDate - bDate;
        });

    if (!matchingAttendance.length) return [];

    const groupedByDate = new Map();

    matchingAttendance.forEach(entry => {
        const timeIn = parseDate(entry.timeIn || entry.timestamp || entry.date);
        const timeOut = parseDate(entry.timeOut);
        if (!timeIn) return;

        const dateKey = timeIn.toLocaleDateString('en-US');
        const hours = timeOut ? Math.max(0, (timeOut - timeIn) / (1000 * 60 * 60)) : 0;
        const existingDay = groupedByDate.get(dateKey) || {
            date: dateKey,
            hours: 0,
            amount: 0,
            hasLogin: true
        };

        existingDay.hours += hours;
        existingDay.hasLogin = true;
        groupedByDate.set(dateKey, existingDay);
    });

    const computedDays = Array.from(groupedByDate.values());

    const totalLoggedDays = computedDays.length;
    const totalNetPay = getPayrollAmountValue(record);

    const sortedDays = computedDays.sort((a, b) => {
        const aDate = parseDate(a.date) || 0;
        const bDate = parseDate(b.date) || 0;
        return aDate - bDate;
    });

    const totalNetPayCents = Math.round(Math.abs(totalNetPay) * 100);
    const centsPerDay = totalLoggedDays > 0 ? Math.floor(totalNetPayCents / totalLoggedDays) : 0;
    let remainingCents = totalLoggedDays > 0 ? totalNetPayCents % totalLoggedDays : 0;
    const multiplier = totalNetPay < 0 ? -1 : 1;

    return sortedDays.map(day => {
        const dayCents = (centsPerDay + (remainingCents > 0 ? 1 : 0)) * multiplier;
        if (remainingCents > 0) remainingCents -= 1;

        return {
            ...day,
            hours: Number(day.hours.toFixed(2)),
            amount: Number((dayCents / 100).toFixed(2))
        };
    });
}

async function addPayrollLog(req, action, payroll = {}) {
    try {
        await db.collection('logs').add({
            action,
            employeeId: payroll.employeeId || null,
            employeeName: payroll.employeeName || null,
            payrollId: payroll.id || null,
            performedBy: req.session && req.session.user ? (req.session.user.uid || req.session.user.email || null) : null,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Failed to write payroll log:', error);
    }
}

exports.managePayroll = async (req, res) => {
    try {
        const [payrollRecordsRaw, usersRaw, attendanceRaw] = await Promise.all([
            payrollModel.getAllPayroll(),
            userModel.getEmployeeUsers(),
            attendanceModel.getAllAttendance()
        ]);
        const payrollRecords = payrollRecordsRaw || [];
        const users = usersRaw || [];
        const attendanceRecords = attendanceRaw || [];

        // Parse your specific document ID format: YYYY-MM-P (e.g., 2026-03-1)
        const parseIdInfo = (id) => {
            const parts = String(id).split('-');
            if (parts.length === 3) {
                return {
                    year: parseInt(parts[0]),
                    month: parseInt(parts[1]) - 1, // 0-indexed for JS
                    periodIdx: parseInt(parts[2])  // 1 = Mid (15th), 2 = End (Last Day)
                };
            }
            return null;
        };

        // 1. Current Selection (Default to March 2026 context)
        const y = req.query.year ? parseInt(req.query.year) : 2026;
        const m = req.query.month !== undefined ? parseInt(req.query.month) : 2;

        // 2. Map existing records into a lookup map using EmployeeId + Year + Month + Period index
        const existingMap = new Map();
        const processedDatabaseRecords = payrollRecords.map(p => {
            const rawPaymentDate = p.paymentDate || p.periodEnd || p.periodStart || p.updatedAt || p.date || p.timestamp;
            const empId = String(p.employeeId || p.userId || '').trim();
            let dateObj = parseDate(rawPaymentDate);

            // Use ID info if date fields are missing in DB
            const idInfo = parseIdInfo(p.id);
            if (!dateObj && idInfo) {
                if (idInfo.periodIdx === 1) dateObj = new Date(idInfo.year, idInfo.month, 15);
                else if (idInfo.periodIdx === 2) dateObj = new Date(idInfo.year, idInfo.month + 1, 0);
            }

            const dayOfMonth = dateObj ? dateObj.getDate() : 0;
            let pIdx = 0;
            if (idInfo) pIdx = idInfo.periodIdx;
            else pIdx = dayOfMonth > 0 && dayOfMonth <= 15 ? 1 : 2;

            let periodLabel = p.period;
            if (!periodLabel) {
                if (idInfo) periodLabel = idInfo.periodIdx === 1 ? 'Mid-Month' : 'End-of-Month';
                else periodLabel = dayOfMonth > 0 && dayOfMonth <= 15 ? 'Mid-Month' : 'End-of-Month';
            }

            return {
                ...p,
                pIdx,
                employeeId: empId,
                employeeName: p.employeeName || p.name || 'Unknown Employee',
                paymentDate: dateObj ? dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A',
                period: periodLabel,
                netPay: getPayrollAmountValue(p).toFixed(2),
                month: dateObj ? dateObj.getMonth() : -1,
                year: dateObj ? dateObj.getFullYear() : -1
            };
        });

        processedDatabaseRecords.forEach(p => {
            if (p.employeeId && p.year === y && p.month === m) {
                const key = `${buildPayrollKey(p.employeeId)}-${p.pIdx}`;
                existingMap.set(key, p);
            }
        });

        const dateFormat = { month: 'long', day: 'numeric', year: 'numeric' };
        const midMonthDateStr = new Date(y, m, 15).toLocaleDateString('en-US', dateFormat);
        const endOfMonthDateStr = new Date(y, m + 1, 0).toLocaleDateString('en-US', dateFormat);

        const finalPayroll = [];
        const dailyHistorySyncTasks = [];

        // 3. Ensure all employees appear with 2 slots for the month
        users.forEach(u => {
            const uId = String(u.id || u.uid || '').trim();
            const employeeCode = String(u.employeeId || '').trim();
            const uName = u.name || u.email || 'Employee';

            const midRecord = existingMap.get(`${uId}-1`) || (employeeCode ? existingMap.get(`${employeeCode}-1`) : null);
            if (midRecord) {
                const normalizedRecord = {
                    ...midRecord,
                    employeeId: uId,
                    employeeCode: employeeCode || midRecord.employeeId || uId,
                    employeeName: midRecord.employeeName || uName,
                    hasSavedRecord: true
                };
                const computedDailyHistory = buildDailyHistory(normalizedRecord, attendanceRecords, u);
                if (!hasStoredDailyLogs(midRecord) && computedDailyHistory.length > 0) {
                    dailyHistorySyncTasks.push(
                        payrollModel.updateDailyHistory(normalizedRecord.id, normalizedRecord.employeeId, computedDailyHistory)
                    );
                }
                finalPayroll.push({
                    ...normalizedRecord,
                    dailyHistory: computedDailyHistory
                });
            } else {
                const defaultMidRecord = {
                    id: 'default-mid-' + uId,
                    employeeId: uId,
                    employeeCode: employeeCode || uId,
                    employeeName: uName,
                    paymentDate: midMonthDateStr,
                    period: 'Mid-Month',
                    netPay: "0.00",
                    status: 'Pending',
                    hasSavedRecord: false,
                    pIdx: 1,
                    year: y,
                    month: m
                };
                finalPayroll.push({
                    ...defaultMidRecord,
                    dailyHistory: buildDailyHistory(defaultMidRecord, attendanceRecords, u)
                });
            }

            const endRecord = existingMap.get(`${uId}-2`) || (employeeCode ? existingMap.get(`${employeeCode}-2`) : null);
            if (endRecord) {
                const normalizedRecord = {
                    ...endRecord,
                    employeeId: uId,
                    employeeCode: employeeCode || endRecord.employeeId || uId,
                    employeeName: endRecord.employeeName || uName,
                    hasSavedRecord: true
                };
                const computedDailyHistory = buildDailyHistory(normalizedRecord, attendanceRecords, u);
                if (!hasStoredDailyLogs(endRecord) && computedDailyHistory.length > 0) {
                    dailyHistorySyncTasks.push(
                        payrollModel.updateDailyHistory(normalizedRecord.id, normalizedRecord.employeeId, computedDailyHistory)
                    );
                }
                finalPayroll.push({
                    ...normalizedRecord,
                    dailyHistory: computedDailyHistory
                });
            } else {
                const defaultEndRecord = {
                    id: 'default-end-' + uId,
                    employeeId: uId,
                    employeeCode: employeeCode || uId,
                    employeeName: uName,
                    paymentDate: endOfMonthDateStr,
                    period: 'End-of-Month',
                    netPay: "0.00",
                    status: 'Pending',
                    hasSavedRecord: false,
                    pIdx: 2,
                    year: y,
                    month: m
                };
                finalPayroll.push({
                    ...defaultEndRecord,
                    dailyHistory: buildDailyHistory(defaultEndRecord, attendanceRecords, u)
                });
            }
        });

        // 4. Group by name, then by period
        finalPayroll.sort((a, b) => {
            const nameComp = (a.employeeName || "").localeCompare(b.employeeName || "");
            if (nameComp !== 0) return nameComp;
            const getPeriodIdx = (p) => p.period === 'Mid-Month' ? 1 : 2;
            return getPeriodIdx(a) - getPeriodIdx(b);
        });

        if (dailyHistorySyncTasks.length > 0) {
            await Promise.allSettled(dailyHistorySyncTasks);
        }

        res.render('manage-payroll', {
            payroll: finalPayroll,
            selectedMonth: m,
            selectedYear: y
        });
    } catch (error) {
        console.error("Payroll Error:", error);
        res.status(500).send("Error loading payroll data.");
    }
};

exports.editPayrollPage = async (req, res) => {
    try {
        const employeeId = String(req.query.employeeId || '').trim();
        const payroll = await payrollModel.getById(req.params.id, employeeId);
        if (!payroll) {
            req.flash('error', 'Payroll record not found.');
            return res.redirect('/manage-payroll');
        }

        // Fetch employee name to display on the edit page
        let employeeName = 'Unknown';
        if (payroll.employeeId) {
            const user = await userModel.getUserById(payroll.employeeId);
            if (user) employeeName = user.name || user.email;
        }
        res.render('edit-payroll', { payroll: { ...payroll, employeeName } });
    } catch (error) {
        req.flash('error', 'Error fetching payroll data.');
        res.redirect('/manage-payroll');
    }
};

exports.updatePayroll = async (req, res) => {
    try {
        // Ensure numeric values are stored correctly as numbers
        const employeeId = String(req.body.employeeId || req.query.employeeId || '').trim();
        const { basic, bonus, deductions, status } = req.body;
        const payrollBeforeUpdate = await payrollModel.getById(req.params.id, employeeId);
        const updateData = {
            basic: parseFloat(basic) || 0,
            bonus: parseFloat(bonus) || 0,
            deductions: parseFloat(deductions) || 0,
            // Assuming netPay is recalculated on the client or in a Cloud Function
            // If you want to recalculate here:
            // netPay: (parseFloat(basic) || 0) + (parseFloat(bonus) || 0) - (parseFloat(deductions) || 0),
            status: status
        };
        await payrollModel.update(req.params.id, updateData, employeeId);
        await addPayrollLog(req, 'Payroll Updated', {
            id: req.params.id,
            employeeId: (payrollBeforeUpdate && payrollBeforeUpdate.employeeId) || employeeId,
            employeeName: payrollBeforeUpdate && payrollBeforeUpdate.employeeName
        });
        req.flash('success', 'Payroll updated successfully.');
    } catch (error) {
        req.flash('error', 'Failed to update payroll.');
    }
    res.redirect('/manage-payroll');
};

exports.deletePayroll = async (req, res) => {
    try {
        const employeeId = String(req.body.employeeId || req.query.employeeId || '').trim();
        const payrollBeforeDelete = await payrollModel.getById(req.params.id, employeeId);
        await payrollModel.delete(req.params.id, employeeId);
        await addPayrollLog(req, 'Payroll Deleted', {
            id: req.params.id,
            employeeId: (payrollBeforeDelete && payrollBeforeDelete.employeeId) || employeeId,
            employeeName: payrollBeforeDelete && payrollBeforeDelete.employeeName
        });
        req.flash('success', 'Payroll record deleted.');
    } catch (error) {
        req.flash('error', 'Failed to delete payroll record.');
    }
    res.redirect('/manage-payroll');
};

exports.processPayroll = async (req, res) => {
    try {
        const employeeId = String(req.body.employeeId || req.query.employeeId || '').trim();
        const payroll = await payrollModel.getById(req.params.id, employeeId);
        if (!payroll) {
            req.flash('error', 'Payroll record not found.');
            return res.redirect('/manage-payroll');
        }

        await payrollModel.updateStatus(req.params.id, 'Processed', employeeId);
        await addPayrollLog(req, 'Payroll Processed', {
            id: req.params.id,
            employeeId: payroll.employeeId || employeeId,
            employeeName: payroll.employeeName
        });
        req.flash('success', 'Payroll processed successfully for this employee.');
    } catch (error) {
        req.flash('error', 'Failed to process payroll.');
    }
    res.redirect('/manage-payroll');
};
