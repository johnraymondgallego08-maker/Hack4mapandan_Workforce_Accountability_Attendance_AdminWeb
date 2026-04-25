const express = require("express");
const router = express.Router();

const userController = require("../controllers/userController");
const leaveController = require("../controllers/leaveController");
const payrollController = require("../controllers/payrollController");
const attendanceController = require("../controllers/attendanceControllers");
const eventAnnouncementController = require("../controllers/eventAnnouncementController");
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const adminMiddleware = require("../middlewares/adminMiddleware");
const securityMiddleware = require('../middlewares/securityMiddleware');
const multer = require('multer');
const path = require('path');
const os = require('os');
const env = require('../config/env');

// Temp storage — controller will move file to correct employee folder
// Add limits and fileFilter to avoid invalid uploads
const upload = multer({
    dest: path.join(os.tmpdir(), '4dmin-panel-uploads'),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(String(file.mimetype || '').toLowerCase())) return cb(null, true);
        return cb(new Error('Only image uploads are allowed'));
    }
});

function runSingleUpload(fieldName) {
    const middleware = upload.single(fieldName);

    return (req, res, next) => {
        middleware(req, res, (error) => {
            if (!error) {
                return next();
            }

            const acceptsJson = String(req.headers.accept || '').includes('application/json');
            let message = error.message || 'File upload failed.';

            if (error instanceof multer.MulterError) {
                if (error.code === 'LIMIT_FILE_SIZE') {
                    message = 'Image is too large. Maximum size is 5 MB.';
                }
            }

            if (acceptsJson) {
                return res.status(400).json({ success: false, error: message });
            }

            if (req.flash) {
                req.flash('error', message);
            }

            const fallbackRedirect = req.originalUrl.includes('/manage-events/edit/')
                ? req.originalUrl
                : req.originalUrl.includes('/manage-events')
                    ? '/manage-events'
                    : '/manage-users';

            return res.redirect(fallbackRedirect);
        });
    };
}

router.use(authMiddleware.isAuthenticated);

router.get("/manage-users", adminMiddleware.isAdmin, userController.manageUsers);
router.get('/register', adminMiddleware.isAdmin, authController.registerPage);
router.post('/register', adminMiddleware.isAdmin, authController.register);
router.get('/users/edit/:id', adminMiddleware.isAdmin, userController.editUserPage);
router.post(
    '/users/edit/:id',
    adminMiddleware.isAdmin,
    runSingleUpload('profileImage'),
    securityMiddleware.verifyCsrfToken,
    userController.updateUser
);
router.post('/users/delete/:id', adminMiddleware.isAdmin, userController.deleteUser);

router.get("/user-info", userController.userInfo);
router.get("/monitor-user", adminMiddleware.isAdmin, userController.monitorUser);

router.get("/manage-leave", adminMiddleware.isAdmin, leaveController.manageLeave);
router.post("/leave/approve/:id", adminMiddleware.isAdmin, leaveController.approveLeave);
router.post("/leave/reject/:id", adminMiddleware.isAdmin, leaveController.rejectLeave);
router.post("/leave/delete/:id", adminMiddleware.isAdmin, leaveController.deleteLeave);
router.get("/manage-events", adminMiddleware.isAdmin, eventAnnouncementController.manageEvents);
router.get("/manage-events/edit/:id", adminMiddleware.isAdmin, eventAnnouncementController.editEventPage);
router.post(
    "/manage-events/create",
    adminMiddleware.isAdmin,
    runSingleUpload('coverImage'),
    securityMiddleware.verifyCsrfToken,
    eventAnnouncementController.createEvent
);
router.post(
    "/manage-events/edit/:id",
    adminMiddleware.isAdmin,
    runSingleUpload('coverImage'),
    securityMiddleware.verifyCsrfToken,
    eventAnnouncementController.updateEvent
);
// status toggle route removed — toggling handled via edit page/actions
router.post("/manage-events/delete/:id", adminMiddleware.isAdmin, eventAnnouncementController.deleteEvent);
router.get("/manage-payroll", adminMiddleware.isAdmin, payrollController.managePayroll);
// Debug endpoint to scan payroll documents and report available months (admin-only)
router.get('/debug/payroll-scan', adminMiddleware.isAdmin, payrollController.debugPayrollScan);
// Dev-only payroll scan (enabled when ALLOW_DEV_DEBUG=true)
router.get('/dev/payroll-scan', async (req, res) => {
    if (env.allowDevDebug) {
        return payrollController.debugPayrollScan(req, res);
    }
    res.status(403).send('Dev debug endpoints are disabled. Set ALLOW_DEV_DEBUG=true to enable.');
});
router.get("/payroll/edit/:id", adminMiddleware.isAdmin, payrollController.editPayrollPage);
router.post("/payroll/edit/:id", adminMiddleware.isAdmin, payrollController.updatePayroll);
router.post("/payroll/delete/:id", adminMiddleware.isAdmin, payrollController.deletePayroll);
router.post("/payroll/process/:id", adminMiddleware.isAdmin, payrollController.processPayroll);

router.get("/attendance-monitor", adminMiddleware.isAdmin, attendanceController.attendanceMonitor);
router.get("/attendance/summary", adminMiddleware.isAdmin, attendanceController.attendanceSummaryEmployee);
router.get("/attendance/add", adminMiddleware.isAdmin, attendanceController.addAttendancePage);
router.post("/attendance/add", adminMiddleware.isAdmin, attendanceController.storeAttendance);
router.get("/attendance/edit/:id", adminMiddleware.isAdmin, attendanceController.editAttendancePage);
router.post("/attendance/edit/:id", adminMiddleware.isAdmin, attendanceController.updateAttendance);
router.post("/attendance/delete/:id", adminMiddleware.isAdmin, attendanceController.deleteAttendance);

router.get("/device-recognition", attendanceController.deviceRecognition);
router.get("/image-recognition", attendanceController.imageRecognition);

module.exports = router;
