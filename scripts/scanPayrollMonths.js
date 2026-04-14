require('dotenv').config();
const payrollModel = require('../models/payrollModel');

function parseDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput && typeof dateInput.toDate === 'function') return dateInput.toDate();
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
}

function parseIdInfo(id) {
    const parts = String(id || '').split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const pIdx = parseInt(parts[2], 10);
        if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(pIdx)) return { year, month, pIdx };
    }
    return null;
}

(async () => {
    try {
        const payrolls = await payrollModel.getAllPayroll();
        const results = payrolls.map(p => {
            const rawPaymentDate = p.paymentDate || p.periodEnd || p.periodStart || p.updatedAt || p.date || p.timestamp;
            let dateObj = parseDate(rawPaymentDate);
            const idInfo = parseIdInfo(p.id);
            if (!dateObj && idInfo) {
                if (idInfo.pIdx === 1) dateObj = new Date(idInfo.year, idInfo.month, 15);
                else dateObj = new Date(idInfo.year, idInfo.month + 1, 0);
            }

            const year = dateObj ? dateObj.getFullYear() : null;
            const month = dateObj ? dateObj.getMonth() : null;
            const pIdx = idInfo ? idInfo.pIdx : (dateObj ? (dateObj.getDate() <= 15 ? 1 : 2) : null);

            return {
                id: p.id,
                employeeId: String(p.employeeId || p.userId || '').trim() || null,
                employeeName: p.employeeName || p.name || null,
                paymentDateRaw: rawPaymentDate || null,
                inferredYear: year,
                inferredMonth: month,
                inferredPIdx: pIdx,
                raw: p
            };
        });

        const monthsMap = new Map();
        results.forEach(r => {
            const key = (r.inferredYear === null || r.inferredMonth === null) ? 'unknown' : `${r.inferredYear}-${String(r.inferredMonth).padStart(2,'0')}`;
            if (!monthsMap.has(key)) monthsMap.set(key, []);
            monthsMap.get(key).push({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, inferredPIdx: r.inferredPIdx });
        });

        const output = {};
        for (const [k, v] of monthsMap.entries()) {
            output[k] = { count: v.length, samples: v.slice(0, 10) };
        }

        console.log(JSON.stringify({ total: results.length, months: Object.keys(output).sort(), details: output }, null, 2));
        process.exit(0);
    } catch (err) {
        console.error('scan failed:', err && err.message ? err.message : err);
        process.exit(2);
    }
})();
