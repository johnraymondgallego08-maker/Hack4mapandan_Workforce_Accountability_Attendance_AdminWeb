const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const eventAnnouncementModel = require('../models/eventAnnouncementModel');
const { admin } = require('../config/firebaseAdmin');

const EVENT_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'events-announcements');

let bucket = null;
try {
    if (admin && admin.storage) {
        const configured = process.env.FIREBASE_STORAGE_BUCKET || undefined;
        bucket = configured ? admin.storage().bucket(configured) : (admin.storage().bucket ? admin.storage().bucket() : null);
    }
} catch (e) { bucket = null; }

let _bucketChecked = false;
let _bucketAvailable = false;

async function ensureBucketAvailable() {
    if (_bucketChecked) return _bucketAvailable;
    _bucketChecked = true;
    if (!bucket) return (_bucketAvailable = false);

    try {
        const [exists] = await bucket.exists();
        _bucketAvailable = !!exists;
        if (!_bucketAvailable) {
            console.warn('[EVENT] Configured Firebase Storage bucket not found, falling back to local storage.');
            bucket = null;
        }
    } catch (err) {
        console.error('[EVENT] Error checking storage bucket availability:', err && err.message ? err.message : err);
        bucket = null;
        _bucketAvailable = false;
    }

    return _bucketAvailable;
}

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

                if (bucket && await ensureBucketAvailable()) {
                    try {
                        await bucket.upload(req.file.path, { destination: destPath, metadata: { contentType: req.file.mimetype } });
                        try { await bucket.file(destPath).makePublic(); } catch (e) {}
                        data.imagePath = destPath;
                        data.imageUrl = `https://storage.googleapis.com/${bucket.name}/${destPath}`;
                        try { await fsp.unlink(req.file.path); } catch (e) {}
                    } catch (err) {
                        console.warn('[EVENT] Firebase Storage upload failed, falling back to local store:', err && err.message ? err.message : err);
                        try { await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true }); } catch (e) {}
                        const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                        await fsp.rename(req.file.path, targetPath);
                        data.imagePath = targetPath;
                        data.imageUrl = `/uploads/events-announcements/${fileName}`;
                        req.flash('warning', 'Image saved locally because Firebase Storage could not be used.');
                    }
                } else {
                    await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                    const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                    await fsp.rename(req.file.path, targetPath);
                    data.imagePath = targetPath;
                    data.imageUrl = `/uploads/events-announcements/${fileName}`;
                    if (!bucket) req.flash('warning', 'No Firebase Storage bucket configured — image saved locally.');
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

                if (bucket && await ensureBucketAvailable()) {
                    try {
                        await bucket.upload(req.file.path, { destination: destPath, metadata: { contentType: req.file.mimetype } });
                        try { await bucket.file(destPath).makePublic(); } catch (e) {}
                        updateData.imagePath = destPath;
                        updateData.imageUrl = `https://storage.googleapis.com/${bucket.name}/${destPath}`;
                        try { await fsp.unlink(req.file.path); } catch (e) {}

                        // delete previous storage file if present
                        if (existing.imagePath && typeof existing.imagePath === 'string' && existing.imagePath.includes('events-announcements/')) {
                            try { await bucket.file(existing.imagePath).delete().catch(() => {}); } catch (e) {}
                        }
                    } catch (err) {
                        console.warn('[EVENT] Firebase Storage upload failed (update), falling back to local store:', err && err.message ? err.message : err);
                        try { await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true }); } catch (e) {}
                        const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                        await fsp.rename(req.file.path, targetPath);
                        updateData.imagePath = targetPath;
                        updateData.imageUrl = `/uploads/events-announcements/${fileName}`;
                        req.flash('warning', 'Image saved locally because Firebase Storage upload failed.');
                        if (existing.imagePath && typeof existing.imagePath === 'string' && fs.existsSync(existing.imagePath)) {
                            try { await fsp.unlink(existing.imagePath); } catch (e) {}
                        }
                    }
                } else {
                    await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                    const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                    await fsp.rename(req.file.path, targetPath);
                    updateData.imagePath = targetPath;
                    updateData.imageUrl = `/uploads/events-announcements/${fileName}`;
                    if (existing.imagePath && typeof existing.imagePath === 'string' && fs.existsSync(existing.imagePath)) {
                        try { await fsp.unlink(existing.imagePath); } catch (e) {}
                    }
                    if (!bucket) req.flash('warning', 'No Firebase Storage bucket configured — image saved locally.');
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

        if (record.imagePath) {
            try {
                if (bucket && typeof record.imagePath === 'string' && record.imagePath.includes('events-announcements/')) {
                    await bucket.file(record.imagePath).delete().catch(() => {});
                } else if (typeof record.imagePath === 'string' && fs.existsSync(record.imagePath)) {
                    await fsp.unlink(record.imagePath).catch(() => {});
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
