const express = require("express");
const router = express.Router();

const attendanceController = require("../controllers/attendanceControllers");
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const securityMiddleware = require("../middlewares/securityMiddleware");

router.get("/", authMiddleware.isAuthenticated, attendanceController.dashboard);

router.get("/attendance", authMiddleware.isAuthenticated, attendanceController.dashboard);

router.get("/login", authController.loginPage);
router.post("/login", securityMiddleware.loginRateLimiter, authController.login);

router.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('admin.sid');
        res.redirect('/login');
    });
});

module.exports = router;
