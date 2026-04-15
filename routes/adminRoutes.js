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
const multer = require('multer');
const path = require('path');

// Temp storage — controller will move file to correct employee folder
const upload = multer({ dest: path.join(__dirname, '../public/uploads/') });

router.use(authMiddleware.isAuthenticated);

router.get("/manage-users", adminMiddleware.isAdmin, userController.manageUsers);
router.get('/register', adminMiddleware.isAdmin, authController.registerPage);
router.post('/register', adminMiddleware.isAdmin, authController.register);
router.get('/users/edit/:id', adminMiddleware.isAdmin, userController.editUserPage);
router.post(
    '/users/edit/:id',
    adminMiddleware.isAdmin,
    upload.single('profileImage'),
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
router.post(
    "/manage-events/create",
    adminMiddleware.isAdmin,
    upload.single('coverImage'),
    eventAnnouncementController.createEvent
);
router.post("/manage-events/delete/:id", adminMiddleware.isAdmin, eventAnnouncementController.deleteEvent);
router.get("/manage-payroll", adminMiddleware.isAdmin, payrollController.managePayroll);
// Debug endpoint to scan payroll documents and report available months (admin-only)
router.get('/debug/payroll-scan', adminMiddleware.isAdmin, payrollController.debugPayrollScan);
// Dev-only payroll scan (enabled when ALLOW_DEV_DEBUG=true)
router.get('/dev/payroll-scan', async (req, res) => {
    if (process.env.ALLOW_DEV_DEBUG === 'true') {
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

router.get("/device-recognition", attendanceController.deviceRecognition);
router.get("/image-recognition", attendanceController.imageRecognition);

module.exports = router;
