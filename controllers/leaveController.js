const leaveModel = require('../models/leaveModel');

exports.manageLeave = async (req, res) => {
    const leaves = await leaveModel.getAll();
    res.render('manage-leave', { leaves });
};

exports.approveLeave = async (req, res) => {
    try {
        await leaveModel.approve(req.params.id);
        req.flash('success', 'Leave request approved.');
    } catch (error) {
        req.flash('error', 'Failed to approve leave request.');
    }
    res.redirect('/manage-leave');
};

exports.rejectLeave = async (req, res) => {
    try {
        await leaveModel.reject(req.params.id);
        req.flash('success', 'Leave request rejected.');
    } catch (error) {
        req.flash('error', 'Failed to reject leave request.');
    }
    res.redirect('/manage-leave');
};

exports.deleteLeave = async (req, res) => {
    try {
        await leaveModel.delete(req.params.id);
        req.flash('success', 'Leave request deleted.');
    } catch (error) {
        req.flash('error', 'Failed to delete leave request.');
    }
    res.redirect('/manage-leave');
};