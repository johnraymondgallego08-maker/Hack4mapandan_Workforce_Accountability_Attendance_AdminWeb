const express = require("express");
const router = express.Router();
const overtimeModel = require("../models/overtimeModel");
const adminMiddleware = require("../middlewares/adminMiddleware");
const authMiddleware = require("../middlewares/authMiddleware");

// GET: Manage Overtime Page
router.get("/manage-overtime", authMiddleware.isAuthenticated, adminMiddleware.isAdmin, async (req, res) => {
    const overtimeRequests = await overtimeModel.getAll();
    res.render("manage overtime", {
        title: "Manage Overtime",
        overtimeRequests: overtimeRequests,
        user: req.session.user
    });
});

// POST: Approve Overtime
router.post("/manage-overtime/approve/:id", authMiddleware.isAuthenticated, adminMiddleware.isAdmin, async (req, res) => {
    const actor = req.session && req.session.user ? { id: req.session.user.uid || req.session.user.id, name: req.session.user.name || req.session.user.email } : {};
    const request = await overtimeModel.approve(req.params.id, actor);

    if (request) {
        req.flash("success", "Overtime request approved successfully.");
    } else {
        req.flash("error", "Request not found.");
    }
    res.redirect("/manage-overtime");
});

// POST: Reject Overtime
router.post("/manage-overtime/reject/:id", authMiddleware.isAuthenticated, adminMiddleware.isAdmin, async (req, res) => {
    const actor = req.session && req.session.user ? { id: req.session.user.uid || req.session.user.id, name: req.session.user.name || req.session.user.email } : {};
    const request = await overtimeModel.reject(req.params.id, actor);

    if (request) {
        req.flash("success", "Overtime request rejected.");
    } else {
        req.flash("error", "Request not found.");
    }
    res.redirect("/manage-overtime");
});

module.exports = router;