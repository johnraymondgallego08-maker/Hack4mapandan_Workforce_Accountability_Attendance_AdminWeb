const { db } = require('../config/firebaseAdmin');
const userModel = require('./userModel');
const APP_TIMEZONE = 'Asia/Manila';

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

    if (hasStatusEntry) {
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
            const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, normalizedDoc);
            const data = {
                ...normalizedDoc,
                transactionHistory: syncedTransactionHistory
            };
            const employeeId = String(data.employeeId || '').trim();

            const user = userMap.get(employeeId);
            const employeeName = data.employeeName || (user ? (user.name || user.email) : 'Unknown');
            payrolls.push({ ...data, employeeId, employeeName });
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
        const syncedTransactionHistory = await syncTransactionHistoryForDoc(doc, data);
        return {
            ...data,
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
            const netPay = basic + bonus - deductions;
            const status = normalizePayrollStatus(data.status || existing.status);
            const updatedAt = new Date();

            await doc.ref.update({
                basic,
                bonus,
                deductions,
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
