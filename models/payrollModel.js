const { db, admin } = require('../config/firebaseAdmin');
const userModel = require('./userModel');
const APP_TIMEZONE = 'Asia/Manila';
const PAYROLL_TRANSACTIONS_COLLECTION = 'payroll_transactions';

function parseDate(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateLabel(value) {
    const date = parseDate(value);
    if (!date) return 'N/A';
    return date.toLocaleString('en-US', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function getNumericValue(value) {
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$₱,\s]/g, '');
        const parsed = parseFloat(cleaned);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizePayrollStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'paid') return 'Paid';
    if (normalized === 'processed') return 'Processed';
    return 'Pending';
}

function buildInvoiceNumber(record = {}) {
    const employeeCode = String(record.employeeCode || record.employeeId || 'EMP').replace(/[^A-Z0-9-]/gi, '').toUpperCase();
    const periodKey = String(record.id || 'PAY').replace(/[^A-Z0-9-]/gi, '').toUpperCase();
    return `INV-${employeeCode}-${periodKey}`;
}

function buildInvoiceData(record = {}, status, timestamp) {
    const issuedAt = parseDate(timestamp) || new Date();
    return {
        invoiceNumber: buildInvoiceNumber(record),
        status,
        issuedAt,
        issuedAtLabel: toDateLabel(issuedAt),
        employeeId: record.employeeId || '',
        employeeCode: record.employeeCode || record.employeeId || '',
        employeeName: record.employeeName || record.name || 'Employee',
        department: record.department || '',
        position: record.position || '',
        period: record.period || '',
        periodStart: record.periodStart || null,
        periodEnd: record.periodEnd || null,
        periodStartLabel: record.periodStart ? toDateLabel(record.periodStart) : null,
        periodEndLabel: record.periodEnd ? toDateLabel(record.periodEnd) : null,
        amount: Number(getNumericValue(
            record.netPay ?? record.netpay ?? record.net_pay ?? record.totalSalary ?? record.total_salary ?? record.amount ?? record.salary ?? 0
        ).toFixed(2)),
        basic: Number(getNumericValue(record.basic).toFixed(2)),
        bonus: Number(getNumericValue(record.bonus).toFixed(2)),
        deductions: Number(getNumericValue(record.deductions).toFixed(2))
    };
}

function toFirestoreTimestamp(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') return value; // already Timestamp
    if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
    const parsed = parseDate(value);
    return parsed ? admin.firestore.Timestamp.fromDate(parsed) : null;
}

function buildPaidTransactionDocId(record = {}, entry = {}) {
    const employeeId = String(record.employeeId || '').trim() || 'employee';
    const payrollId = String(record.id || record.payrollId || '').trim() || 'payroll';
    const entryId = String(entry.id || '').trim() || `paid-${Date.now()}`;
    return `${employeeId}-${payrollId}-${entryId}`.replace(/[\/\\#?\s]+/g, '_');
}

function parsePayrollIdPeriod(payrollId = '') {
    const parts = String(payrollId || '').split('-');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const periodIdx = parseInt(parts[2], 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(periodIdx)) return null;
    if (periodIdx !== 1 && periodIdx !== 2) return null;
    return { year, month, periodIdx };
}

function buildPayDateInfo(record = {}) {
    const payrollId = String(record.id || '').trim();
    const parsed = parsePayrollIdPeriod(payrollId);
    if (!parsed) return { paySlot: '', payDate: null, payDateLabel: '' };

    const year = parsed.year;
    const monthIndex = parsed.month - 1; // payroll id month is 1-12
    const paySlot = parsed.periodIdx === 1 ? '15' : 'end';
    const payDate = parsed.periodIdx === 1
        ? new Date(year, monthIndex, 15)
        : new Date(year, monthIndex + 1, 0);

    return {
        paySlot,
        payDate,
        payDateLabel: payDate.toLocaleDateString('en-US', {
            timeZone: APP_TIMEZONE,
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    };
}

async function upsertPaidTransactionRecord(record = {}, entry = {}) {
    const invoice = entry.invoice || null;
    if (!invoice) return null;

    const docId = buildPaidTransactionDocId(record, entry);
    const ref = db.collection(PAYROLL_TRANSACTIONS_COLLECTION).doc(docId);

    const issuedAt = parseDate(invoice.issuedAt || entry.timestamp) || new Date();

    const payDateInfo = buildPayDateInfo(record);

    const payload = {
        employeeId: String(invoice.employeeId || record.employeeId || '').trim(),
        employeeCode: String(invoice.employeeCode || record.employeeCode || record.employeeId || '').trim(),
        employeeName: String(invoice.employeeName || record.employeeName || record.name || 'Employee'),
        department: String(invoice.department || record.department || ''),
        position: String(invoice.position || record.position || ''),
        payrollId: String(record.id || '').trim(),
        payrollPath: record.payrollPath || null,
        paySlot: payDateInfo.paySlot || null,
        payDate: payDateInfo.payDate ? toFirestoreTimestamp(payDateInfo.payDate) : null,
        payDateLabel: payDateInfo.payDateLabel || null,
        status: 'Paid',
        action: entry.action || 'Payroll Paid',
        amount: Number(getNumericValue(invoice.amount).toFixed(2)),
        invoiceNumber: String(invoice.invoiceNumber || ''),
        sourceEntryId: String(entry.id || ''),
        invoice,
        issuedAt: toFirestoreTimestamp(issuedAt) || admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
    };

    await ref.set(payload, { merge: true });
    return { id: docId, ...payload };
}

async function ensurePaidTransactionRecords(record = {}, transactionHistory = []) {
    const paidEntries = (Array.isArray(transactionHistory) ? transactionHistory : []).filter((entry) => entry && entry.status === 'Paid' && entry.invoice);
    if (!paidEntries.length) return;

    // Upsert the latest Paid entry (by timestamp) so we don't spam writes.
    const latestPaid = paidEntries
        .slice()
        .sort((a, b) => {
            const aDate = parseDate(a.timestamp) || 0;
            const bDate = parseDate(b.timestamp) || 0;
            return bDate - aDate;
        })[0];

    // Deterministic doc id includes entry.id, so this becomes idempotent for each paid event.
    await upsertPaidTransactionRecord(record, latestPaid);
}

function normalizeTransactionEntry(entry = {}, record = {}) {
    const timestamp = parseDate(entry.timestamp || entry.createdAt || entry.updatedAt || record.updatedAt || record.paymentDate || new Date()) || new Date();
    const status = normalizePayrollStatus(entry.status || entry.payrollStatus || record.status);
    const amount = Number(getNumericValue(entry.amount ?? record.netPay ?? record.netpay ?? record.net_pay ?? record.totalSalary ?? record.total_salary ?? 0).toFixed(2));
    const invoice = entry.invoice || (status === 'Paid' ? buildInvoiceData(record, status, timestamp) : null);

    return {
        id: String(entry.id || `${String(record.id || 'payroll').replace(/\s+/g, '-')}-${status.toLowerCase()}`),
        status,
        action: entry.action || `Payroll ${status}`,
        note: entry.note || '',
        amount,
        timestamp,
        timestampLabel: toDateLabel(timestamp),
        invoice
    };
}

function normalizeTransactionHistory(record = {}) {
    const list = Array.isArray(record.transactionHistory) ? record.transactionHistory : [];
    return list
        .map((entry) => normalizeTransactionEntry(entry, record))
        .sort((a, b) => {
            const aDate = parseDate(a.timestamp) || 0;
            const bDate = parseDate(b.timestamp) || 0;
            return bDate - aDate;
        });
}

async function writeTransactionHistory(docRef, record = {}, transactionHistory = []) {
    await docRef.update({
        transactionHistory: transactionHistory.map((entry) => ({
            id: entry.id,
            status: entry.status,
            action: entry.action,
            note: entry.note || '',
            amount: entry.amount,
            timestamp: entry.timestamp,
            invoice: entry.invoice || null
        })),
        updatedAt: new Date()
    });
}

async function syncTransactionHistoryForDoc(doc, record = {}) {
    const status = normalizePayrollStatus(record.status);
    const normalizedHistory = normalizeTransactionHistory(record);
    const hasStatusEntry = normalizedHistory.some((entry) => entry.status === status);

    // Special rule: if the payroll is saved while status stays Paid, create a new Paid history entry
    // so the separate transaction ledger shows every paid update as its own receipt.
    if (status === 'Paid') {
        const recordTimestamp = parseDate(record.updatedAt || record.paymentDate || record.periodEnd || record.periodStart || new Date()) || new Date();
        const latestPaid = normalizedHistory.find((entry) => entry && entry.status === 'Paid') || null;
        const latestPaidTimestamp = latestPaid ? (parseDate(latestPaid.timestamp) || null) : null;

        // Skip if we just wrote one very recently (avoid duplicate writes on fast consecutive calls).
        const shouldAppend = !latestPaidTimestamp || (recordTimestamp.getTime() - latestPaidTimestamp.getTime() > 1500);

        if (shouldAppend) {
            const newEntry = normalizeTransactionEntry({
                id: `${String(record.id || doc.id)}-paid-${recordTimestamp.getTime()}`,
                status: 'Paid',
                action: 'Payroll Paid',
                amount: getNumericValue(record.netPay ?? record.netpay ?? record.net_pay ?? record.totalSalary ?? record.total_salary ?? 0),
                timestamp: recordTimestamp,
                invoice: buildInvoiceData(record, 'Paid', recordTimestamp)
            }, record);

            const nextHistory = [newEntry, ...normalizedHistory];
            await writeTransactionHistory(doc.ref, record, nextHistory);
            await ensurePaidTransactionRecords(record, nextHistory);
            return nextHistory;
        }
    }

    if (hasStatusEntry) {
        await ensurePaidTransactionRecords(record, normalizedHistory);
        return normalizedHistory;
    }

    const timestamp = parseDate(record.updatedAt || record.paymentDate || record.periodEnd || record.periodStart || new Date()) || new Date();
    const newEntry = normalizeTransactionEntry({
        id: `${String(record.id || doc.id)}-${status.toLowerCase()}-${timestamp.getTime()}`,
        status,
        action: `Payroll ${status}`,
        amount: getNumericValue(record.netPay ?? record.netpay ?? record.net_pay ?? record.totalSalary ?? record.total_salary ?? 0),
        timestamp,
        invoice: status === 'Paid' ? buildInvoiceData(record, status, timestamp) : null
    }, record);

    const nextHistory = [newEntry, ...normalizedHistory];
    await writeTransactionHistory(doc.ref, record, nextHistory);
    await ensurePaidTransactionRecords(record, nextHistory);
    return nextHistory;
}

function normalizePayrollRecord(doc) {
    const data = doc.data();
    const parentDoc = doc.ref.parent ? doc.ref.parent.parent : null;
    const parentEmployeeId = parentDoc ? String(parentDoc.id).trim() : '';
    const employeeId = String(data.employeeId || data.userId || parentEmployeeId || '').trim();

    return {
        id: doc.id,
        employeeId,
        parentEmployeeId,
        payrollPath: doc.ref.path,
        ...data,
        status: normalizePayrollStatus(data.status),
        transactionHistory: normalizeTransactionHistory({ id: doc.id, employeeId, ...data })
    };
}

async function findPayrollDoc(id, employeeId = '') {
    const snapshot = await db.collectionGroup('payroll').get();
    const targetId = String(id || '').trim();
    const targetEmployeeId = String(employeeId || '').trim();

    const sameIdDocs = snapshot.docs.filter(d => String(d.id).trim() === targetId);
    if (!sameIdDocs.length) return null;
    if (!targetEmployeeId) return sameIdDocs[0];

    const exactMatch = sameIdDocs.find(d => {
        const data = d.data() || {};
        const parentDoc = d.ref.parent ? d.ref.parent.parent : null;
        const parentId = parentDoc ? String(parentDoc.id).trim() : '';
        const dataEmployeeId = String(data.employeeId || data.userId || '').trim();
        return parentId === targetEmployeeId || dataEmployeeId === targetEmployeeId;
    });

    return exactMatch || sameIdDocs[0];
}

exports.getAllPayroll = async () => {
    try {
        // Fetch all employees via userModel to resolve names correctly
        const users = await userModel.getEmployeeUsers();
        const userMap = new Map();
        users.forEach(u => {
            const primaryId = String(u.id || u.uid || '').trim();
            const employeeCode = String(u.employeeId || '').trim();

            if (primaryId) userMap.set(primaryId, u);
            if (employeeCode) userMap.set(employeeCode, u);
        });

        // Use collectionGroup to match database structure (sub-collections)
        const snapshot = await db.collectionGroup('payroll').get();
        const payrolls = [];
        for (const doc of snapshot.docs) {
            const normalizedDoc = normalizePayrollRecord(doc);
            const employeeId = String(normalizedDoc.employeeId || '').trim();

            const user = userMap.get(employeeId) || null;
            const employeeName = normalizedDoc.employeeName || (user ? (user.name || user.email) : 'Unknown');
            const employeeCode = normalizedDoc.employeeCode || (user ? (user.employeeId || '') : '') || employeeId;

            // Important: sync invoice history using enriched employee info so receipts look correct.
            const enrichedRecord = {
                ...normalizedDoc,
                employeeId,
                employeeName,
                employeeCode,
                email: normalizedDoc.email || (user ? (user.email || '') : ''),
                department: normalizedDoc.department || (user ? (user.department || '') : ''),
                position: normalizedDoc.position || (user ? (user.position || '') : ''),
            };

            const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, enrichedRecord);
            payrolls.push({
                ...enrichedRecord,
                transactionHistory: syncedTransactionHistory
            });
        }

        payrolls.sort((a, b) => {
            const nameA = (a.employeeName || '').toLowerCase();
            const nameB = (b.employeeName || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        return payrolls;
    } catch (error) {
        console.error("Error getting payroll records:", error);
        return [];
    }
};

exports.getById = async (id, employeeId = '') => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (!doc) return null;

        const data = normalizePayrollRecord(doc);
        const resolvedEmployeeId = String(data.employeeId || employeeId || '').trim();
        let user = null;
        if (resolvedEmployeeId) {
            user = await userModel.getUserById(resolvedEmployeeId);
        }

        const enrichedRecord = {
            ...data,
            employeeId: resolvedEmployeeId || data.employeeId,
            employeeName: data.employeeName || (user ? (user.name || user.email) : undefined),
            employeeCode: data.employeeCode || (user ? (user.employeeId || '') : '') || resolvedEmployeeId,
            email: data.email || (user ? (user.email || '') : ''),
            department: data.department || (user ? (user.department || '') : ''),
            position: data.position || (user ? (user.position || '') : ''),
        };

        const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, enrichedRecord);
        return {
            ...enrichedRecord,
            transactionHistory: syncedTransactionHistory,
            netPay: data.netPay ?? data.netpay ?? data.net_pay ?? data.totalSalary ?? data.total_salary ?? data.amount ?? data.salary ?? 0,
            paymentDate: data.paymentDate ?? data.periodEnd ?? data.periodStart ?? data.updatedAt ?? data.date ?? data.timestamp ?? null
        };
    } catch (error) {
        console.error("Error fetching payroll by ID:", error);
        return null;
    }
};

exports.update = async (id, data, employeeId = '') => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (doc) {
            const existing = normalizePayrollRecord(doc);
            const basic = parseFloat(data.basic) || 0;
            const bonus = parseFloat(data.bonus) || 0;
            const deductions = parseFloat(data.deductions) || 0;
            
            // Prioritize netPay if explicitly provided, otherwise calculate from breakdown
            const calculatedNetPay = (data.netPay !== undefined && data.netPay !== null) 
                                     ? parseFloat(data.netPay) || 0 : (basic + bonus - deductions);
            const netPay = basic + bonus - deductions;
            const status = normalizePayrollStatus(data.status || existing.status);
            const updatedAt = new Date();

            await doc.ref.update({
                basic,
                bonus,
                deductions,
                netPay: calculatedNetPay,
                netpay: calculatedNetPay, // Keep both for compatibility
                status: data.status || 'Pending',
                updatedAt: new Date()
                netPay,
                netpay: netPay,
                status,
                updatedAt
            });

            const updatedRecord = {
                ...existing,
                basic,
                bonus,
                deductions,
                netPay,
                netpay: netPay,
                status,
                updatedAt
            };
            const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, updatedRecord);
            await writeTransactionHistory(doc.ref, updatedRecord, syncedTransactionHistory);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error updating payroll:", error);
        return false;
    }
};

exports.delete = async (id, employeeId = '') => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (doc) {
            await doc.ref.delete();
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error deleting payroll:", error);
        return false;
    }
};

exports.updateStatus = async (id, status, employeeId = '') => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (doc) {
            const existing = normalizePayrollRecord(doc);
            const normalizedStatus = normalizePayrollStatus(status || existing.status);
            const updatedAt = new Date();
            await doc.ref.update({
                status: normalizedStatus,
                updatedAt
            });
            const updatedRecord = {
                ...existing,
                status: normalizedStatus,
                updatedAt
            };
            const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, updatedRecord);
            await writeTransactionHistory(doc.ref, updatedRecord, syncedTransactionHistory);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error updating payroll status:", error);
        return false;
    }
};

exports.updateDailyHistory = async (id, employeeId = '', dailyHistory = []) => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (!doc) return false;

        await doc.ref.update({
            dailyHistory: Array.isArray(dailyHistory) ? dailyHistory : [],
            dailyLogs: Array.isArray(dailyHistory) ? dailyHistory : [],
            dailyComputation: Array.isArray(dailyHistory) ? dailyHistory : [],
            updatedAt: new Date()
        });
        return true;
    } catch (error) {
        console.error("Error updating payroll daily history:", error);
        return false;
    }
};

exports.ensureTransactionHistory = async (id, employeeId = '') => {
    try {
        const doc = await findPayrollDoc(id, employeeId);
        if (!doc) return [];

        const record = normalizePayrollRecord(doc);
        const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, record);
        await writeTransactionHistory(doc.ref, record, syncedTransactionHistory);
        return syncedTransactionHistory;
    } catch (error) {
        console.error('Error ensuring payroll transaction history:', error);
        return [];
    }
};

exports.getPaidTransactionsByMonthYear = async (year, month) => {
    try {
        const y = parseInt(year, 10);
        const m = parseInt(month, 10);
        if (Number.isNaN(y) || Number.isNaN(m)) return [];

        const start = new Date(y, m, 1, 0, 0, 0, 0);
        const end = new Date(y, m + 1, 0, 23, 59, 59, 999);

        const startTs = admin.firestore.Timestamp.fromDate(start);
        const endTs = admin.firestore.Timestamp.fromDate(end);

        const snapshot = await db.collection(PAYROLL_TRANSACTIONS_COLLECTION)
            .where('issuedAt', '>=', startTs)
            .where('issuedAt', '<=', endTs)
            .orderBy('issuedAt', 'desc')
            .get();

        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error loading paid payroll transactions:', error);
        return [];
    }
};
