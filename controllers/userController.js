const userModel = require('../models/userModel');
// To robustly handle module loading and prevent circular dependency issues
// that can cause `admin` to be undefined, we import the entire module.
const firebaseAdmin = require('../config/firebaseAdmin');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const supabaseImageService = require('../services/supabaseImageService');

function isAdminLikeRole(roleValue) {
    const role = String(roleValue || '').trim().toLowerCase();
    return ['admin', 'administrator', 'system admin', 'system_admin', 'super admin', 'superadmin'].includes(role);
}

function normalizeOptionalText(value, fallback = undefined) {
    if (value === undefined) return fallback;
    return String(value || '').trim();
}

function normalizeEmployeeStatus(value, fallback = 'Active') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'suspended') return 'Suspended';
    if (normalized === 'inactive') return 'Inactive';
    if (normalized === 'active') return 'Active';
    return fallback;
}

function normalizeEmploymentType(value, fallback = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'regular' || normalized === 'full-time regular' || normalized === 'full time regular') {
        return 'Regular';
    }
    if (normalized === 'part-time' || normalized === 'part time' || normalized === 'partime') {
        return 'Part-Time';
    }
    return fallback;
}

function sanitizeFileName(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

async function handleProfileImageUpload(file, userId, displayName) {
    if (!file) return null;

    const safeBaseName = sanitizeFileName(displayName) || `user-${Date.now()}`;
    const extension = path.extname(file.originalname || file.filename || '') || '.jpg';
    const remotePath = `employee-images/${userId}/${safeBaseName}-${Date.now()}${extension}`;
    const mimeType = String(file.mimetype || '').toLowerCase();

    try {
        if (supabaseImageService.isConfigured()) {
            const buffer = await fsp.readFile(file.path);
            const uploadResult = await supabaseImageService.uploadToSupabase(buffer, remotePath, mimeType || 'image/jpeg');
            try { await fsp.unlink(file.path); } catch (e) {}
            return uploadResult.imageUrl;
        }

        const folderBaseName = String(displayName || 'Unknown').replace(/[^a-z0-9]/gi, '_');
        const folderName = `${folderBaseName}_${userId}`;
        const targetDir = path.join(__dirname, '../public/employee_images', folderName);
        await fsp.mkdir(targetDir, { recursive: true });
        const targetPath = path.join(targetDir, 'profile.jpg');
        await fsp.rename(file.path, targetPath);
        return `/employee_images/${folderName}/profile.jpg`;
    } catch (error) {
        try { if (file && file.path) await fsp.unlink(file.path); } catch (e) {}
        throw error;
    }
}

exports.manageUsers = async (req, res) => {
    try {
        const users = await userModel.getEmployeeUsers();
        res.render('manage-users', {
            users,
            success_msg: req.flash('success'),
            error_msg: req.flash('error')
        });
    } catch (error) {
        console.error("Error loading users:", error);
        req.flash('error', 'Error loading users list.');
        res.redirect('/dashboard');
    }
};

exports.userInfo = async (req, res) => {
    try {
        // Fetch fresh user data and employee list in parallel for faster loading
        let [user, employees] = await Promise.all([
            userModel.getUserById(req.session.user.uid),
            userModel.getEmployeeUsers()
        ]);

        if (!user) {
            user = req.session.user; // Fallback to session if admin isn't in employees collection
        }
        res.render('user-info', { user, employees: employees || [] });
    } catch (error) {
        console.error("Error fetching user info:", error);
        res.render('user-info', { user: req.session.user, employees: [] });
    }
};

exports.updateProfile = async (req, res) => {
    const userId = req.session.user.uid;
    const { name, email, password, department, position } = req.body;

    try {
        // 1. Prepare updates for Firebase Authentication (Password/Email/Name)
        const authUpdates = {};
        if (email) authUpdates.email = email;
        if (name) authUpdates.displayName = name;
        if (password && password.trim() !== "") {
            authUpdates.password = password;
        }
        if (Object.keys(authUpdates).length > 0) {
            await firebaseAdmin.admin.auth().updateUser(userId, authUpdates);
        }

        // 2. Prepare updates for Firestore
        const dbUpdates = { name, email, department, position };

        // Handle Profile Image
        if (req.file) {
            const user = await userModel.getUserById(userId);
            try {
                const uploadedImageUrl = await handleProfileImageUpload(
                    req.file,
                    userId,
                    name || (user ? user.name : null) || 'Unknown'
                );
                dbUpdates.profileImage = uploadedImageUrl;
                dbUpdates.photoUrl = uploadedImageUrl;
            } catch (err) {
                console.error('Failed to save profile image:', err);
                req.flash('error', 'Failed to save profile image.');
                return res.redirect('/user-info');
            }
        }

        // Remove undefined fields
        Object.keys(dbUpdates).forEach(key => dbUpdates[key] === undefined && delete dbUpdates[key]);

        await userModel.updateUser(userId, dbUpdates);

        // 3. If the user is an Admin, sync changes to the 'Admin' collection as well
        if (req.session.user && req.session.user.role === 'Admin') {
            const adminUpdates = {};
            if (name) adminUpdates.name = name;
            if (email) adminUpdates.email = email;
            if (dbUpdates.photoUrl) adminUpdates.photoUrl = dbUpdates.photoUrl;

            if (Object.keys(adminUpdates).length > 0) {
                await firebaseAdmin.db.collection('Admin').doc(userId).set(adminUpdates, { merge: true });
            }
        }

        // Update session data to reflect changes immediately across all pages
        if (req.session.user) {
            if (name) req.session.user.name = name;
            if (email) req.session.user.email = email;
            if (dbUpdates.photoUrl) req.session.user.photoUrl = dbUpdates.photoUrl;
            if (dbUpdates.profileImage) req.session.user.profileImage = dbUpdates.profileImage;
            req.session.save(); // Force save to session store
        }

        req.flash('success', 'Profile updated successfully.');
    } catch (error) {
        req.flash('error', 'Failed to update profile: ' + error.message);
    }
    res.redirect('/user-info');
};

exports.monitorUser = async (req, res) => {
    const users = await userModel.getEmployeeUsers();
    res.render('monitor-user', { users });
};

exports.editUserPage = async (req, res) => {
    try {
        const userToEdit = await userModel.getUserById(req.params.id);
        if (!userToEdit) {
            req.flash('error', 'User not found.');
            return res.redirect('/manage-users');
        }
        if (isAdminLikeRole(userToEdit.role)) {
            req.flash('error', 'Admin accounts are hidden from employee management pages.');
            return res.redirect('/manage-users');
        }
        res.render('edit-user', { userToEdit });
    } catch (error) {
        req.flash('error', 'Error fetching user data.');
        res.redirect('/manage-users');
    }
};

exports.updateUser = async (req, res) => {
    const userId = req.params.id;
    const {
        name: rawName,
        email: rawEmail,
        password,
        role: rawRole,
        status: rawStatus,
        department: rawDepartment,
        position: rawPosition,
        employmentStatus: rawEmploymentStatus,
        workSchedule: rawWorkSchedule,
        supervisor: rawSupervisor
    } = req.body;

    try {
        const existingUser = await userModel.getUserById(userId);
        if (!existingUser) {
            req.flash('error', 'User not found.');
            return res.redirect('/manage-users');
        }
        if (isAdminLikeRole(existingUser.role)) {
            req.flash('error', 'Admin accounts are hidden from employee management pages.');
            return res.redirect('/manage-users');
        }

        const name = normalizeOptionalText(rawName, existingUser.name || '');
        const email = normalizeOptionalText(rawEmail, existingUser.email || '');
        const role = normalizeOptionalText(rawRole, existingUser.role || 'employee');
        const status = normalizeEmployeeStatus(rawStatus, normalizeEmployeeStatus(existingUser.status, 'Active'));
        const department = normalizeOptionalText(rawDepartment, existingUser.department || '');
        const position = normalizeOptionalText(rawPosition, existingUser.position || '');
        const employmentStatus = normalizeEmploymentType(
            rawEmploymentStatus,
            normalizeEmploymentType(existingUser.employmentStatus, '')
        );
        const workSchedule = normalizeOptionalText(rawWorkSchedule, existingUser.workSchedule || '');
        const supervisor = normalizeOptionalText(rawSupervisor, existingUser.supervisor || '');

        // 1. Prepare updates for Firebase Authentication
        const authUpdates = {};
        if (email) authUpdates.email = email;
        if (name) authUpdates.displayName = name;
        if (password && password.trim() !== "") {
            authUpdates.password = password;
        }

        if (Object.keys(authUpdates).length > 0) {
            await firebaseAdmin.admin.auth().updateUser(userId, authUpdates);
        }

        // 2. Prepare updates for Firestore
        const dbUpdates = {};
        if (name) dbUpdates.name = name;
        if (email) dbUpdates.email = email;
        if (role) dbUpdates.role = role;
        dbUpdates.status = status;
        dbUpdates.department = department;
        dbUpdates.position = position;
        dbUpdates.employmentStatus = employmentStatus;
        dbUpdates.workSchedule = workSchedule;
        dbUpdates.supervisor = supervisor;
        dbUpdates.updatedAt = new Date().toISOString();

        // Synchronize status with Firebase Auth disabled state to block mobile app
        const isDisabled = (status.toLowerCase() === 'suspended' || status.toLowerCase() === 'inactive');
        await firebaseAdmin.admin.auth().updateUser(userId, { disabled: isDisabled });

        // 3. Handle Profile Photo Upload → save to employee's own folder
        if (req.file) {
            try {
                const uploadedImageUrl = await handleProfileImageUpload(req.file, userId, name || existingUser.name || 'Unknown');
                dbUpdates.profileImage = uploadedImageUrl;
                dbUpdates.photoUrl = uploadedImageUrl;
            } catch (err) {
                console.error('Failed to save profile image:', err);
                req.flash('error', 'Failed to save profile image.');
                return res.redirect('/manage-users');
            }
        }

        if (Object.keys(dbUpdates).length > 0) {
            await userModel.updateUser(userId, dbUpdates);

            // If Admin is updating their own account, sync their session immediately
            if (req.session.user && req.session.user.uid === userId) {
                if (name) req.session.user.name = name;
                if (email) req.session.user.email = email;
                req.session.user.status = status;
                req.session.save();
            }
        }

        req.flash('success', 'User updated successfully.');
    } catch (error) {
        console.error("Error updating user:", error);
        req.flash('error', 'Failed to update user: ' + error.message);
    }
    res.redirect('/manage-users');
};

exports.deleteUser = async (req, res) => {
    const userId = req.params.id;
    try {
        const existingUser = await userModel.getUserById(userId);
        if (existingUser && isAdminLikeRole(existingUser.role)) {
            req.flash('error', 'Admin accounts are hidden from employee management pages.');
            return res.redirect('/manage-users');
        }

        // 1. Delete from Firebase Authentication
        try {
            await firebaseAdmin.admin.auth().deleteUser(userId);
        } catch (authError) {
            // Ignore 'user-not-found' error so we can still clean up the DB
            console.log(`[DELETE] Auth user delete skipped: ${authError.message}`);
        }

        // 2. Delete from Firestore & Clean up local files
        await userModel.deleteUser(userId);

        req.flash('success', 'User deleted successfully.');
    } catch (error) {
        console.error("Error deleting user:", error);
        req.flash('error', 'Failed to delete user: ' + (error && error.message ? error.message : 'unknown error'));
    }
    res.redirect('/manage-users');
};
