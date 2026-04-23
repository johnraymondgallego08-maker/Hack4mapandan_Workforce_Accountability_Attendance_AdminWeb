const { db } = require('../config/firebaseAdmin');
const userModel = require('./userModel');

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
        ...data
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
        snapshot.forEach(doc => {
            const data = normalizePayrollRecord(doc);
            const employeeId = String(data.employeeId || '').trim();

            const user = userMap.get(employeeId);
            const employeeName = data.employeeName || (user ? (user.name || user.email) : 'Unknown');
            payrolls.push({ ...data, employeeId, employeeName });
        });

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
        return {
            ...data,
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
            const basic = parseFloat(data.basic) || 0;
            const bonus = parseFloat(data.bonus) || 0;
            const deductions = parseFloat(data.deductions) || 0;
            
            // Prioritize netPay if explicitly provided, otherwise calculate from breakdown
            const calculatedNetPay = (data.netPay !== undefined && data.netPay !== null) 
                                     ? parseFloat(data.netPay) || 0 : (basic + bonus - deductions);

            await doc.ref.update({
                basic,
                bonus,
                deductions,
                netPay: calculatedNetPay,
                netpay: calculatedNetPay, // Keep both for compatibility
                status: data.status || 'Pending',
                updatedAt: new Date()
            });
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
            await doc.ref.update({
                status: status || 'Processed',
                updatedAt: new Date()
            });
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
