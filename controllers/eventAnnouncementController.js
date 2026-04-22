const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const eventAnnouncementModel = require('../models/eventAnnouncementModel');
const supabaseImageService = require('../services/supabaseImageService');

function sanitizeFileName(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function parseDateInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d;
}

function wantsJson(req) {
    return req.xhr || req.headers?.accept?.includes('application/json');
}

function respondError(req, res, redirectPath, message, statusCode = 400) {
    if (wantsJson(req)) {
        return res.status(statusCode).json({ success: false, error: message });
    }

    req.flash('error', message);
    return res.redirect(redirectPath);
}

function respondSuccess(req, res, redirectPath, message, payload = {}) {
    if (wantsJson(req)) {
        return res.status(200).json({ success: true, message, ...payload });
    }

    req.flash('success', message);
    return res.redirect(redirectPath);
}

exports.manageEvents = async (req, res) => {
    try {
        const records = await eventAnnouncementModel.getAll();
        const publishedRecords = records.filter((record) => eventAnnouncementModel.isPublishedStatus(record.status));
        const draftRecords = records.filter((record) => !eventAnnouncementModel.isPublishedStatus(record.status));
        res.render('manage-events', { records, publishedRecords, draftRecords });
    } catch (err) {
        console.error('Error loading manage events:', err);
        req.flash('error', 'Failed to load records');
        res.render('manage-events', { records: [], publishedRecords: [], draftRecords: [] });
    }
};

exports.createEvent = async (req, res) => {
    try {
        const type = String(req.body.type || 'announcement').trim();
        const title = String(req.body.title || '').trim();
        const summary = sanitizeHtml(String(req.body.summary || '').trim() || '');
        const content = sanitizeHtml(String(req.body.content || '').trim() || '');
        const eventDate = parseDateInput(req.body.eventDate);
        const eventTime = String(req.body.eventTime || '').trim();
        const location = String(req.body.location || '').trim();
        const status = String(req.body.status || 'Public').trim();

        if (!title) {
            return respondError(req, res, '/manage-events', 'Title is required');
        }

        const data = { type, title, summary, content, eventDate, eventTime, location, status };

        if (req.file) {
            try {
                const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                const mimetype = String(req.file.mimetype || '').toLowerCase();
                if (!allowed.includes(mimetype)) {
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    return respondError(req, res, '/manage-events', 'Invalid file type.');
                }

                const extension = path.extname(req.file.originalname || req.file.filename || '') || '.jpg';
                const base = sanitizeFileName(title) || `entry-${Date.now()}`;
                const fileName = `${base}-${Date.now()}${extension}`;
                const destPath = `events-announcements/${fileName}`;

                try {
                    const buffer = await fsp.readFile(req.file.path);
                    const uploadResult = await supabaseImageService.uploadToSupabase(buffer, destPath, mimetype);

                    data.imageUrl = uploadResult.imageUrl;
                    data.imagePath = uploadResult.imagePath;
                    data.imageStorage = uploadResult.imageStorage;
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                } catch (err) {
                    console.error('[EVENT] Supabase upload failed:', err.message);
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    return respondError(req, res, '/manage-events', 'Failed to upload image to storage. Please ensure Supabase is configured properly.', 500);
                }
            } catch (e) {
                console.error('Failed to process uploaded image:', e);
                try { if (req.file && req.file.path) await fsp.unlink(req.file.path); } catch (e) {}
                return respondError(req, res, '/manage-events', 'Failed to save uploaded image', 500);
            }
        }

        const createdRecord = await eventAnnouncementModel.create(data);
        return respondSuccess(req, res, '/manage-events', 'Event created', { record: createdRecord });
    } catch (err) {
        console.error('Error creating event:', err);
        return respondError(req, res, '/manage-events', 'Unexpected error creating event', 500);
    }
};

exports.editEventPage = async (req, res) => {
    try {
        const id = req.params.id;
        const record = await eventAnnouncementModel.getById(id);
        if (!record) {
            req.flash('error', 'Event not found');
            return res.redirect('/manage-events');
        }
        res.render('edit-event', { record });
    } catch (err) {
        console.error('Error loading edit page:', err);
        req.flash('error', 'Unexpected error');
        return res.redirect('/manage-events');
    }
};

exports.updateEvent = async (req, res) => {
    try {
        const id = req.params.id;
        const existing = await eventAnnouncementModel.getById(id);
        if (!existing) {
            return respondError(req, res, '/manage-events', 'Event not found', 404);
        }

        const type = String(req.body.type || existing.type || 'announcement').trim();
        const title = String(req.body.title || existing.title || '').trim();
        const summary = sanitizeHtml(String(req.body.summary || existing.summary || '').trim() || '');
        const content = sanitizeHtml(String(req.body.content || existing.content || '').trim() || '');
        const eventDate = parseDateInput(req.body.eventDate) || existing.eventDate || null;
        const eventTime = String(req.body.eventTime || existing.eventTime || '').trim();
        const location = String(req.body.location || existing.location || '').trim();
        const status = String(typeof req.body.status === 'undefined' ? existing.status : req.body.status).trim();

        if (!title) {
            return respondError(req, res, `/manage-events/edit/${id}`, 'Title is required');
        }

        const updateData = { type, title, summary, content, eventDate, eventTime, location, status };

        if (req.file) {
            try {
                const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                const mimetype = String(req.file.mimetype || '').toLowerCase();
                if (!allowed.includes(mimetype)) {
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    return respondError(req, res, `/manage-events/edit/${id}`, 'Invalid file type.');
                }

                const extension = path.extname(req.file.originalname || req.file.filename || '') || '.jpg';
                const base = sanitizeFileName(title) || `entry-${Date.now()}`;
                const fileName = `${base}-${Date.now()}${extension}`;
                const destPath = `events-announcements/${fileName}`;

                try {
                    const buffer = await fsp.readFile(req.file.path);
                    const uploadResult = await supabaseImageService.uploadToSupabase(buffer, destPath, mimetype);

                    updateData.imageUrl = uploadResult.imageUrl;
                    updateData.imagePath = uploadResult.imagePath;
                    updateData.imageStorage = uploadResult.imageStorage;
                    try { await fsp.unlink(req.file.path); } catch (e) {}

                    // Remove previous Supabase file if present
                    if (existing.imageStorage === 'supabase' && existing.imagePath) {
                        const deleteResult = await supabaseImageService.deleteFromSupabase(existing.imagePath);
                        if (!deleteResult.success) {
                            console.warn('[EVENT] Could not delete previous Supabase image:', deleteResult.error);
                        }
                    }
                } catch (err) {
                    console.error('[EVENT] Supabase upload failed (update):', err.message);
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    return respondError(req, res, `/manage-events/edit/${id}`, 'Failed to upload image to storage. Please ensure Supabase is configured properly.', 500);
                }
            } catch (e) {
                console.error('Failed to process uploaded image:', e);
                try { if (req.file && req.file.path) await fsp.unlink(req.file.path); } catch (e) {}
                return respondError(req, res, `/manage-events/edit/${id}`, 'Failed to process uploaded image.', 500);
            }
        }

        if (eventAnnouncementModel.isPublishedStatus(status) && existing.publishedAt) {
            updateData.publishedAt = existing.publishedAt;
        }

        await eventAnnouncementModel.update(id, updateData);
        const updatedRecord = await eventAnnouncementModel.getById(id);
        return respondSuccess(req, res, '/manage-events', 'Event updated', { record: updatedRecord });
    } catch (err) {
        console.error('Error updating event:', err);
        return respondError(req, res, `/manage-events/edit/${req.params.id}`, 'Unexpected error updating event', 500);
    }
};

exports.deleteEvent = async (req, res) => {
    try {
        const id = req.params.id;
        const record = await eventAnnouncementModel.getById(id);
        if (!record) {
            return respondError(req, res, '/manage-events', 'Record not found', 404);
        }

        await eventAnnouncementModel.delete(id);

        if (record.imagePath && record.imageStorage === 'supabase') {
            try {
                const deleteResult = await supabaseImageService.deleteFromSupabase(record.imagePath);
                if (!deleteResult.success) {
                    console.warn('[EVENT] Could not delete Supabase image:', deleteResult.error);
                }
            } catch (e) { console.error('Failed to remove image after delete:', e); }
        }

        return respondSuccess(req, res, '/manage-events', 'Record deleted successfully.', { id });
    } catch (err) {
        console.error('Error deleting event or announcement:', err);
        return respondError(req, res, '/manage-events', 'Failed to delete the record.', 500);
    }
};
