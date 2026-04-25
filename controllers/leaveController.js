const leaveModel = require('../models/leaveModel');

function wantsJson(req) {
    return req.xhr || String(req.headers.accept || '').includes('application/json');
}

exports.manageLeave = async (req, res) => {
    try {
        const leaves = await leaveModel.getAll();
        res.render('manage-leave', { leaves });
    } catch (error) {
        console.error('Error loading leave list:', error);
        req.flash('error', 'Failed to load leave requests.');
        res.render('manage-leave', { leaves: [] });
    }
};

exports.approveLeave = async (req, res) => {
    try {
        await leaveModel.approve(req.params.id);
        if (wantsJson(req)) {
            return res.json({ success: true, status: 'Approved' });
        }
        req.flash('success', 'Leave request approved.');
    } catch (error) {
        if (wantsJson(req)) {
            return res.status(400).json({ success: false, error: 'Failed to approve leave request.' });
        }
        req.flash('error', 'Failed to approve leave request.');
    }
    res.redirect('/manage-leave');
};

exports.rejectLeave = async (req, res) => {
    try {
        await leaveModel.reject(req.params.id);
        if (wantsJson(req)) {
            return res.json({ success: true, status: 'Rejected' });
        }
        req.flash('success', 'Leave request rejected.');
    } catch (error) {
        if (wantsJson(req)) {
            return res.status(400).json({ success: false, error: 'Failed to reject leave request.' });
        }
        req.flash('error', 'Failed to reject leave request.');
    }
    res.redirect('/manage-leave');
};

exports.deleteLeave = async (req, res) => {
    try {
        await leaveModel.delete(req.params.id);
        if (wantsJson(req)) {
            return res.json({ success: true, deleted: true });
        }
        req.flash('success', 'Leave request deleted.');
    } catch (error) {
        if (wantsJson(req)) {
            return res.status(400).json({ success: false, error: 'Failed to delete leave request.' });
        }
        req.flash('error', 'Failed to delete leave request.');
    }
    res.redirect('/manage-leave');
};
