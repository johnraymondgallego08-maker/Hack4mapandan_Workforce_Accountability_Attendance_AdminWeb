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

exports.manageEvents = async (req, res) => {
    try {
        const records = await eventAnnouncementModel.getAll();
        res.render('manage-events', { records });
    } catch (err) {
        console.error('Error loading manage events:', err);
        req.flash('error', 'Failed to load records');
        res.render('manage-events', { records: [] });
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
            req.flash('error', 'Title is required');
            return res.redirect('/manage-events');
        }

        const data = { type, title, summary, content, eventDate, eventTime, location, status };

        if (req.file) {
            try {
                const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                const mimetype = String(req.file.mimetype || '').toLowerCase();
                if (!allowed.includes(mimetype)) {
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    req.flash('error', 'Invalid file type.');
                    return res.redirect('/manage-events');
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
                    req.flash('error', 'Failed to upload image to storage. Please ensure Supabase is configured properly.');
                    return res.redirect('/manage-events');
                }
            } catch (e) {
                console.error('Failed to process uploaded image:', e);
                try { if (req.file && req.file.path) await fsp.unlink(req.file.path); } catch (e) {}
                req.flash('error', 'Failed to save uploaded image');
                return res.redirect('/manage-events');
            }
        }

        await eventAnnouncementModel.create(data);
        req.flash('success', 'Event created');
        res.redirect('/manage-events');
    } catch (err) {
        console.error('Error creating event:', err);
        req.flash('error', 'Unexpected error creating event');
        res.redirect('/manage-events');
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
            req.flash('error', 'Event not found');
            return res.redirect('/manage-events');
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
            req.flash('error', 'Title is required');
            return res.redirect(`/manage-events/edit/${id}`);
        }

        const updateData = { type, title, summary, content, eventDate, eventTime, location, status };

        if (req.file) {
            try {
                const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
                const mimetype = String(req.file.mimetype || '').toLowerCase();
                if (!allowed.includes(mimetype)) {
                    try { await fsp.unlink(req.file.path); } catch (e) {}
                    req.flash('error', 'Invalid file type.');
                    return res.redirect(`/manage-events/edit/${id}`);
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
                    req.flash('error', 'Failed to upload image to storage. Please ensure Supabase is configured properly.');
                    return res.redirect(`/manage-events/edit/${id}`);
                }
            } catch (e) {
                console.error('Failed to process uploaded image:', e);
                try { if (req.file && req.file.path) await fsp.unlink(req.file.path); } catch (e) {}
                req.flash('error', 'Failed to process uploaded image.');
                return res.redirect(`/manage-events/edit/${id}`);
            }
        }

        await eventAnnouncementModel.update(id, updateData);
        req.flash('success', 'Event updated');
        res.redirect('/manage-events');
    } catch (err) {
        console.error('Error updating event:', err);
        req.flash('error', 'Unexpected error updating event');
        res.redirect(`/manage-events/edit/${req.params.id}`);
    }
};

exports.deleteEvent = async (req, res) => {
    try {
        const id = req.params.id;
        const record = await eventAnnouncementModel.getById(id);
        if (!record) {
            req.flash('error', 'Record not found');
            return res.redirect('/manage-events');
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

        req.flash('success', 'Record deleted successfully.');
        res.redirect('/manage-events');
    } catch (err) {
        console.error('Error deleting event or announcement:', err);
        req.flash('error', 'Failed to delete the record.');
        res.redirect('/manage-events');
    }
};
