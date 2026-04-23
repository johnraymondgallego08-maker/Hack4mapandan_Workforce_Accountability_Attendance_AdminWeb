const payrollModel = require('../models/payrollModel');
const userModel = require('../models/userModel');
const attendanceModel = require('../models/attendanceModel');
const { db } = require('../config/firebaseAdmin');
const env = require('../config/env');
const APP_TIMEZONE = 'Asia/Manila';

// Helper to safely handle Firestore Timestamps or Strings
function parseDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') return dateInput.toDate();
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateOnly(value, options = {}) {
    const date = parseDate(value);
    if (!date) return null;
    return date.toLocaleDateString('en-US', {
        timeZone: APP_TIMEZONE,
        ...options
    });
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

function hasMeaningfulAmount(value) {
    return Math.abs(getNumericValue(value)) > 0.004;
}

function hasExplicitPayrollBreakdown(record = {}) {
    return ['basic', 'bonus', 'deductions'].some((key) => {
        const value = record[key];
        return value !== undefined && value !== null && String(value).trim() !== '';
    });
}

function sumDailyHistoryAmounts(dailyHistory = []) {
    if (!Array.isArray(dailyHistory) || dailyHistory.length === 0) return 0;
    const total = dailyHistory.reduce((sum, day) => sum + getNumericValue(day && day.amount), 0);
    return Number(total.toFixed(2));
}

function resolvePayrollDisplayAmounts(record = {}, dailyHistory = []) {
    const savedNetPay = Number(getPayrollAmountValue(record).toFixed(2));
    const computedNetPay = sumDailyHistoryAmounts(dailyHistory);
    const hasSavedRecord = Boolean(record.hasSavedRecord);
    const hasBreakdown = hasExplicitPayrollBreakdown(record);

    let displayNetPay = savedNetPay;
    let displayAmountSource = 'saved';

    if (!hasSavedRecord && computedNetPay > 0) {
        displayNetPay = computedNetPay;
        displayAmountSource = 'computed';
    } else if (hasSavedRecord && !hasBreakdown && !hasMeaningfulAmount(savedNetPay) && computedNetPay > 0) {
        displayNetPay = computedNetPay;
        displayAmountSource = 'computed-fallback';
    }

    return {
        savedNetPay,
        computedNetPay,
        displayNetPay: Number(displayNetPay.toFixed(2)),
        displayAmountSource
    };
}

function buildPayrollKey(value) {
    return String(value || '').trim();
}

function buildPayrollUserKey(user = {}) {
    const primaryId = buildPayrollKey(user.id || user.uid || user.employeeId || user.employeeCode);
    const employeeCode = buildPayrollKey(user.employeeId);
    return primaryId || employeeCode || String(user.name || user.email || '').trim().toLowerCase();
}

function dedupePayrollUsers(users = []) {
    const userMap = new Map();

    users.forEach((user) => {
        if (!user) return;
        const key = buildPayrollUserKey(user);
        if (!key) return;

        const existing = userMap.get(key);
        if (!existing) {
            userMap.set(key, user);
            return;
        }

        const existingScore = [
            existing.name,
            existing.email,
            existing.employeeId,
            existing.id || existing.uid
        ].filter(Boolean).length;
        const incomingScore = [
            user.name,
            user.email,
            user.employeeId,
            user.id || user.uid
        ].filter(Boolean).length;

        if (incomingScore > existingScore) {
            userMap.set(key, { ...existing, ...user });
        }
    });

    return Array.from(userMap.values());
}

function getDefaultPayrollDateSelection(referenceDate = new Date()) {
    return referenceDate.getDate() <= 15 ? '15' : 'end';
}

function normalizePayrollDateSelection(value, referenceDate = new Date()) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'all') return 'all';
    if (normalized === '15' || normalized === 'mid' || normalized === 'mid-month') return '15';
    if (normalized === '30' || normalized === 'end' || normalized === 'end-of-month') return 'end';
    return getDefaultPayrollDateSelection(referenceDate);
}

function choosePreferredPayrollRow(currentRow, incomingRow) {
    if (!currentRow) return incomingRow;
    if (!incomingRow) return currentRow;

    const scoreRow = (row) => {
        const updatedAt = parseDate(row.updatedAt || row.paymentDate || row.periodEnd || row.periodStart || row.date || row.timestamp);
        return [
            row.hasSavedRecord ? 4 : 0,
            hasExplicitPayrollBreakdown(row) ? 3 : 0,
            hasMeaningfulAmount(row.savedNetPay !== undefined ? row.savedNetPay : row.netPay) ? 2 : 0,
            Array.isArray(row.dailyHistory) && row.dailyHistory.length > 0 ? 1 : 0,
            updatedAt ? updatedAt.getTime() : 0
        ];
    };

    const currentScore = scoreRow(currentRow);
    const incomingScore = scoreRow(incomingRow);

    for (let index = 0; index < currentScore.length; index += 1) {
        if (incomingScore[index] > currentScore[index]) return incomingRow;
        if (incomingScore[index] < currentScore[index]) return currentRow;
    }

    return currentRow;
}

function chooseDefaultGroupedPayrollDate(groupedRow = {}, referenceDate = new Date()) {
    const midRecord = groupedRow.midRecord || null;
    const endRecord = groupedRow.endRecord || null;

    if (midRecord && midRecord.hasSavedRecord && (!endRecord || !endRecord.hasSavedRecord)) {
        return '15';
    }

    if (endRecord && endRecord.hasSavedRecord && (!midRecord || !midRecord.hasSavedRecord)) {
        return 'end';
    }

    return getDefaultPayrollDateSelection(referenceDate);
}

function buildUserLookupMap(users = []) {
    const lookup = new Map();
    users.forEach((user) => {
        if (!user) return;
        const keys = [
            String(user.id || '').trim(),
            String(user.uid || '').trim(),
            String(user.employeeId || '').trim(),
            String(user.email || '').trim().toLowerCase()
        ].filter(Boolean);

        keys.forEach((key) => lookup.set(key, user));
    });
    return lookup;
}

function enrichPayrollRecordWithUser(record = {}, user = {}) {
    return {
        ...user,
        ...record,
        employeeId: record.employeeId || user.id || user.uid || user.employeeId || '',
        employeeCode: record.employeeCode || record.employeeId || user.employeeId || '',
        employeeName: record.employeeName || user.name || user.email || 'Employee',
        email: record.email || user.email || '',
        department: record.department || user.department || '',
        position: record.position || user.position || '',
        office: record.office || user.office || '',
        phone: record.phone || user.phone || '',
        supervisor: record.supervisor || user.supervisor || '',
        workSchedule: record.workSchedule || user.workSchedule || '',
        employmentStatus: record.employmentStatus || user.employmentStatus || '',
        imageUrl: record.imageUrl || user.imageUrl || user.photoUrl || user.profileImage || ''
    };
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
                    ? formatDateOnly(dateObj)
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

        const dateKey = formatDateOnly(timeIn);
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
        const users = dedupePayrollUsers(usersRaw || []);
        const attendanceRecords = attendanceRaw || [];
        const userLookup = buildUserLookupMap(users);

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

        // 1. Current Selection — default to today's year/month when not provided
        const now = new Date();
        const defaultYear = now.getFullYear();
        const defaultMonth = now.getMonth(); // 0-indexed

        let y = req.query.year !== undefined ? parseInt(req.query.year, 10) : defaultYear;
        if (Number.isNaN(y)) y = defaultYear;

        let m;
        if (req.query.month !== undefined) {
            m = parseInt(req.query.month, 10);
            if (Number.isNaN(m) || m < 0 || m > 11) m = defaultMonth;
        } else {
            m = defaultMonth;
        }

        const selectedPayrollDate = normalizePayrollDateSelection(req.query.payDate, now);

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
                paymentDate: dateObj ? formatDateOnly(dateObj, { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A',
                period: periodLabel,
                netPay: getPayrollAmountValue(p).toFixed(2),
                month: dateObj ? dateObj.getMonth() : -1,
                year: dateObj ? dateObj.getFullYear() : -1
            };
        });

        // Enable optional debug logging by setting DEBUG_PAYROLL_MATCH=1 in your environment
        const debugPayroll = env.debugPayrollMatch;

        // Index existing payroll records by several possible identifiers so matching is resilient
        processedDatabaseRecords.forEach(p => {
            if (p.year !== y || p.month !== m) return;

            const candidateIds = new Set();
            if (p.employeeId) candidateIds.add(buildPayrollKey(p.employeeId));
            if (p.parentEmployeeId) candidateIds.add(buildPayrollKey(p.parentEmployeeId));
            if (p.employeeCode) candidateIds.add(buildPayrollKey(p.employeeCode));
            if (p.userId) candidateIds.add(buildPayrollKey(p.userId));

            // Also include any id-like fields found in the document
            ['id', 'payrollId', 'payroll_id'].forEach(k => {
                if (p[k]) candidateIds.add(buildPayrollKey(p[k]));
            });

            candidateIds.forEach(cid => {
                if (!cid) return;
                const key = `${cid}-${p.pIdx}`;
                // Prefer existing explicit employeeId mapping but allow overwriting if necessary
                if (!existingMap.has(key)) existingMap.set(key, p);
            });
        });

        // Ensure employees referenced by payroll records are included in the users list
        // (some payroll docs may exist for employeeIds that are not present in the users list)
        try {
            const userIdSet = new Set((users || []).map(u => String(u.id || u.uid || '').trim()).filter(Boolean));
            const employeeCodeSet = new Set((users || []).map(u => String(u.employeeId || '').trim()).filter(Boolean));

            processedDatabaseRecords.forEach(p => {
                if (p.year !== y || p.month !== m) return;
                const candidateId = String(p.employeeId || p.userId || p.parentEmployeeId || p.employeeCode || '').trim();
                if (!candidateId) return;
                if (!userIdSet.has(candidateId) && !employeeCodeSet.has(candidateId)) {
                    // Add a lightweight placeholder user so payroll rows render for this employee
                    users.push({ id: candidateId, uid: candidateId, employeeId: candidateId, name: p.employeeName || 'Employee' });
                    userIdSet.add(candidateId);
                }
            });
        } catch (e) {
            if (debugPayroll) console.error('[Payroll Debug] Failed to augment users list from payroll records:', e && e.message ? e.message : e);
        }

        const dateFormat = { month: 'long', day: 'numeric', year: 'numeric' };
        const midMonthDateStr = formatDateOnly(new Date(y, m, 15), dateFormat);
        const endOfMonthDateStr = formatDateOnly(new Date(y, m + 1, 0), dateFormat);

        const finalPayroll = [];
        const dailyHistorySyncTasks = [];

        // 3. Ensure all employees appear with 2 slots for the month
        users.forEach(u => {
            const uId = String(u.id || u.uid || '').trim();
            const employeeCode = String(u.employeeId || '').trim();
            const uName = u.name || u.email || 'Employee';

            let midRecord = existingMap.get(`${uId}-1`) || (employeeCode ? existingMap.get(`${employeeCode}-1`) : null);
            // Fallback: search processedDatabaseRecords for a matching record in the selected month/year
            if (!midRecord) {
                if (debugPayroll) {
                    const monthCandidates = processedDatabaseRecords.filter(p => p.pIdx === 1 && p.year === y && p.month === m);
                    console.log(`[Payroll Debug] Searching MID for user ${uId} (${employeeCode}) in ${y}-${m}. Records in month: ${monthCandidates.length}`);
                }

                midRecord = processedDatabaseRecords.find(p => {
                    if (p.pIdx !== 1) return false;
                    if (p.year !== y || p.month !== m) return false;
                    const candidates = new Set([
                        buildPayrollKey(p.employeeId),
                        buildPayrollKey(p.parentEmployeeId),
                        buildPayrollKey(p.employeeCode),
                        buildPayrollKey(p.userId),
                    ]);
                    if (candidates.has(uId) || (employeeCode && candidates.has(employeeCode))) return true;
                    // Fallback to name match (case-insensitive)
                    if (p.employeeName && uName && String(p.employeeName).trim().toLowerCase() === String(uName).trim().toLowerCase()) return true;
                    return false;
                }) || null;

                if (debugPayroll) {
                    if (midRecord) {
                        console.log(`[Payroll Debug] Matched MID payroll id=${midRecord.id} for user ${uId} — fields: employeeId=${midRecord.employeeId}, parentEmployeeId=${midRecord.parentEmployeeId}, employeeCode=${midRecord.employeeCode}, employeeName='${midRecord.employeeName}'`);
                    } else {
                        console.log(`[Payroll Debug] No MID payroll match found for user ${uId} (${employeeCode}) in ${y}-${m}`);
                    }
                }
            }
            if (midRecord) {
                const matchedUser = userLookup.get(String(uId).trim()) || userLookup.get(String(employeeCode).trim()) || null;
                const normalizedRecord = {
                    ...enrichPayrollRecordWithUser(midRecord, matchedUser || u),
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
                const amountInfo = resolvePayrollDisplayAmounts(normalizedRecord, computedDailyHistory);
                finalPayroll.push({
                    ...normalizedRecord,
                    dailyHistory: computedDailyHistory,
                    ...amountInfo
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
                const computedDailyHistory = buildDailyHistory(defaultMidRecord, attendanceRecords, u);
                const amountInfo = resolvePayrollDisplayAmounts(defaultMidRecord, computedDailyHistory);
                finalPayroll.push({
                    ...defaultMidRecord,
                    dailyHistory: computedDailyHistory,
                    ...amountInfo
                });
            }

            let endRecord = existingMap.get(`${uId}-2`) || (employeeCode ? existingMap.get(`${employeeCode}-2`) : null);
            if (!endRecord) {
                if (debugPayroll) {
                    const monthCandidates = processedDatabaseRecords.filter(p => p.pIdx === 2 && p.year === y && p.month === m);
                    console.log(`[Payroll Debug] Searching END for user ${uId} (${employeeCode}) in ${y}-${m}. Records in month: ${monthCandidates.length}`);
                }

                endRecord = processedDatabaseRecords.find(p => {
                    if (p.pIdx !== 2) return false;
                    if (p.year !== y || p.month !== m) return false;
                    const candidates = new Set([
                        buildPayrollKey(p.employeeId),
                        buildPayrollKey(p.parentEmployeeId),
                        buildPayrollKey(p.employeeCode),
                        buildPayrollKey(p.userId),
                    ]);
                    if (candidates.has(uId) || (employeeCode && candidates.has(employeeCode))) return true;
                    if (p.employeeName && uName && String(p.employeeName).trim().toLowerCase() === String(uName).trim().toLowerCase()) return true;
                    return false;
                }) || null;

                if (debugPayroll) {
                    if (endRecord) {
                        console.log(`[Payroll Debug] Matched END payroll id=${endRecord.id} for user ${uId} — fields: employeeId=${endRecord.employeeId}, parentEmployeeId=${endRecord.parentEmployeeId}, employeeCode=${endRecord.employeeCode}, employeeName='${endRecord.employeeName}'`);
                    } else {
                        console.log(`[Payroll Debug] No END payroll match found for user ${uId} (${employeeCode}) in ${y}-${m}`);
                    }
                }
            }
            if (endRecord) {
                const matchedUser = userLookup.get(String(uId).trim()) || userLookup.get(String(employeeCode).trim()) || null;
                const normalizedRecord = {
                    ...enrichPayrollRecordWithUser(endRecord, matchedUser || u),
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
                const amountInfo = resolvePayrollDisplayAmounts(normalizedRecord, computedDailyHistory);
                finalPayroll.push({
                    ...normalizedRecord,
                    dailyHistory: computedDailyHistory,
                    ...amountInfo
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
                const computedDailyHistory = buildDailyHistory(defaultEndRecord, attendanceRecords, u);
                const amountInfo = resolvePayrollDisplayAmounts(defaultEndRecord, computedDailyHistory);
                finalPayroll.push({
                    ...defaultEndRecord,
                    dailyHistory: computedDailyHistory,
                    ...amountInfo
                });
            }
        });

        const dedupedPayrollMap = new Map();
        finalPayroll.forEach((row) => {
            const rowKey = `${buildPayrollKey(row.employeeId || row.employeeCode || row.employeeName)}-${row.pIdx}`;
            const preferredRow = choosePreferredPayrollRow(dedupedPayrollMap.get(rowKey), row);
            dedupedPayrollMap.set(rowKey, preferredRow);
        });

        const groupedPayrollMap = new Map();
        Array.from(dedupedPayrollMap.values()).forEach((row) => {
            const rowKey = buildPayrollKey(row.employeeId || row.employeeCode || row.employeeName);
            const existingGroup = groupedPayrollMap.get(rowKey) || {
                employeeId: row.employeeId,
                employeeCode: row.employeeCode || row.employeeId || '',
                employeeName: row.employeeName || 'Employee',
                midRecord: null,
                endRecord: null
            };

            if (row.pIdx === 1) {
                existingGroup.midRecord = row;
            } else {
                existingGroup.endRecord = row;
            }

            groupedPayrollMap.set(rowKey, existingGroup);
        });

        const groupedPayroll = Array.from(groupedPayrollMap.values())
            .map((group) => {
                const defaultPayDate = chooseDefaultGroupedPayrollDate(group, now);
                const selectedRecord = defaultPayDate === '15'
                    ? (group.midRecord || group.endRecord)
                    : (group.endRecord || group.midRecord);

                return {
                    ...group,
                    selectedPayDate: defaultPayDate,
                    selectedRecord
                };
            })
            .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

        if (dailyHistorySyncTasks.length > 0) {
            await Promise.allSettled(dailyHistorySyncTasks);
        }

        const paidTransactions = await payrollModel.getPaidTransactionsByMonthYear(y, m);

        res.render('manage-payroll', {
            payroll: groupedPayroll,
            paidTransactions,
            selectedMonth: m,
            selectedYear: y,
            selectedPayrollDate
        });
    } catch (error) {
        console.error("Payroll Error:", error);
        res.status(500).send("Error loading payroll data.");
    }
};

// Admin debug: scan all payroll docs and report derived year/month/period info
exports.debugPayrollScan = async (req, res) => {
    try {
        const snapshot = await db.collectionGroup('payroll').get();
        const results = snapshot.docs.map(doc => {
            const data = doc.data() || {};

            const parseIdInfo = (id) => {
                const parts = String(id).split('-');
                if (parts.length === 3) {
                    const year = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10) - 1;
                    const periodIdx = parseInt(parts[2], 10);
                    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(periodIdx)) {
                        return { year, month, periodIdx };
                    }
                }
                return null;
            };

            let dateObj = parseDate(data.paymentDate || data.periodEnd || data.periodStart || data.updatedAt || data.date || data.timestamp);
            const idInfo = parseIdInfo(doc.id);
            if (!dateObj && idInfo) {
                if (idInfo.periodIdx === 1) dateObj = new Date(idInfo.year, idInfo.month, 15);
                else dateObj = new Date(idInfo.year, idInfo.month + 1, 0);
            }

            const year = dateObj ? dateObj.getFullYear() : null;
            const month = dateObj ? dateObj.getMonth() : null;
            const pIdx = idInfo ? idInfo.periodIdx : (dateObj ? (dateObj.getDate() <= 15 ? 1 : 2) : null);

            const parentDoc = doc.ref.parent ? doc.ref.parent.parent : null;
            const parentEmployeeId = parentDoc ? String(parentDoc.id) : null;

            return {
                id: doc.id,
                path: doc.ref.path,
                employeeId: String(data.employeeId || data.userId || parentEmployeeId || '').trim() || null,
                employeeName: data.employeeName || data.name || null,
                rawPaymentDate: data.paymentDate || null,
                rawPeriodStart: data.periodStart || null,
                rawPeriodEnd: data.periodEnd || null,
                inferredYear: year,
                inferredMonth: month,
                inferredPeriodIdx: pIdx
            };
        });

        // aggregate months present
        const monthsSet = new Set();
        results.forEach(r => {
            if (r.inferredYear !== null && r.inferredMonth !== null) monthsSet.add(`${r.inferredYear}-${r.inferredMonth}`);
        });

        res.json({ count: results.length, months: Array.from(monthsSet).sort(), records: results });
    } catch (error) {
        console.error('Debug payroll scan failed:', error.message);
        res.status(500).json({ error: error.message });
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
