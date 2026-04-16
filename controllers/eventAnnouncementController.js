const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const eventAnnouncementModel = require('../models/eventAnnouncementModel');

// Supabase client (must be configured for cloud storage)
let supabase = null;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || null;
try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    }
} catch (e) {
    supabase = null;
}

const EVENT_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'events-announcements');

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

                if (supabase && supabaseBucket) {
                    try {
                        const buffer = await fsp.readFile(req.file.path);
                        const { data: uploadData, error: uploadError } = await supabase.storage.from(supabaseBucket).upload(destPath, buffer, { contentType: req.file.mimetype, upsert: false });
                        if (uploadError) throw uploadError;
                        const { data: publicData } = supabase.storage.from(supabaseBucket).getPublicUrl(destPath);
                        data.imagePath = destPath;
                        data.imageUrl = (publicData && publicData.publicUrl) ? publicData.publicUrl : null;
                        data.imageStorage = 'supabase';
                        try { await fsp.unlink(req.file.path); } catch (e) {}
                    } catch (err) {
                        console.error('[EVENT] Supabase upload failed:', err && err.message ? err.message : err);
                        // Local fallback: move file to public/uploads and save local URL
                        try {
                            await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                            const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                            await fsp.rename(req.file.path, targetPath);
                            data.imagePath = `/uploads/events-announcements/${fileName}`;
                            data.imageUrl = `/uploads/events-announcements/${fileName}`;
                            data.imageStorage = 'local';
                        } catch (localErr) {
                            console.error('[EVENT] Local fallback failed:', localErr && localErr.message ? localErr.message : localErr);
                            try { await fsp.unlink(req.file.path); } catch (e) {}
                            req.flash('warning', 'Image upload failed; event saved without image.');
                        }
                    }
                } else {
                    // Supabase not configured — keep a local copy and store its public path
                    try {
                        await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                        const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                        await fsp.rename(req.file.path, targetPath);
                        data.imagePath = `/uploads/events-announcements/${fileName}`;
                        data.imageUrl = `/uploads/events-announcements/${fileName}`;
                        data.imageStorage = 'local';
                    } catch (localErr) {
                        console.error('[EVENT] Local save failed:', localErr && localErr.message ? localErr.message : localErr);
                        try { await fsp.unlink(req.file.path); } catch (e) {}
                        req.flash('warning', 'Supabase not configured; event saved without image.');
                    }
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

                // Try Supabase first, fallback to local
                if (supabase && supabaseBucket) {
                    try {
                        const buffer = await fsp.readFile(req.file.path);
                        const { data: uploadData, error: uploadError } = await supabase.storage.from(supabaseBucket).upload(destPath, buffer, { contentType: req.file.mimetype, upsert: false });
                        if (uploadError) throw uploadError;
                        const { data: publicData } = supabase.storage.from(supabaseBucket).getPublicUrl(destPath);
                        updateData.imagePath = destPath;
                        updateData.imageUrl = (publicData && publicData.publicUrl) ? publicData.publicUrl : null;
                        updateData.imageStorage = 'supabase';
                        try { await fsp.unlink(req.file.path); } catch (e) {}
                        // remove previous supabase file if present
                        if (existing.imageStorage === 'supabase' && existing.imagePath) {
                            try { await supabase.storage.from(supabaseBucket).remove([existing.imagePath]).catch(() => {}); } catch (e) {}
                        }
                    } catch (err) {
                        console.error('[EVENT] Supabase upload failed (update):', err && err.message ? err.message : err);
                        // Local fallback: move file into public uploads and set local URL
                        try {
                            await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                            const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                            await fsp.rename(req.file.path, targetPath);
                            updateData.imagePath = `/uploads/events-announcements/${fileName}`;
                            updateData.imageUrl = `/uploads/events-announcements/${fileName}`;
                            updateData.imageStorage = 'local';
                            // delete previous local image if present
                            if (existing.imageStorage === 'local' && existing.imagePath && typeof existing.imagePath === 'string' && fs.existsSync(path.join(process.cwd(), existing.imagePath.replace(/^\//, '')))) {
                                try { await fsp.unlink(path.join(process.cwd(), existing.imagePath.replace(/^\//, ''))).catch(() => {}); } catch (e) {}
                            }
                        } catch (localErr) {
                            console.error('[EVENT] Local fallback failed (update):', localErr && localErr.message ? localErr.message : localErr);
                            try { await fsp.unlink(req.file.path); } catch (e) {}
                            req.flash('warning', 'Image upload failed; event updated without changing the image.');
                        }
                    }
                } else {
                    // Supabase not configured — save locally
                    try {
                        await fsp.mkdir(EVENT_UPLOAD_DIR, { recursive: true });
                        const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);
                        await fsp.rename(req.file.path, targetPath);
                        updateData.imagePath = `/uploads/events-announcements/${fileName}`;
                        updateData.imageUrl = `/uploads/events-announcements/${fileName}`;
                        updateData.imageStorage = 'local';
                        if (existing.imageStorage === 'local' && existing.imagePath && typeof existing.imagePath === 'string' && fs.existsSync(path.join(process.cwd(), existing.imagePath.replace(/^\//, '')))) {
                            try { await fsp.unlink(path.join(process.cwd(), existing.imagePath.replace(/^\//, ''))).catch(() => {}); } catch (e) {}
                        }
                    } catch (localErr) {
                        console.error('[EVENT] Local save failed (update):', localErr && localErr.message ? localErr.message : localErr);
                        try { await fsp.unlink(req.file.path); } catch (e) {}
                        req.flash('warning', 'Supabase not configured; image not saved.');
                    }
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
                if (record.imageStorage === 'supabase' && supabase && supabaseBucket) {
                    try { await supabase.storage.from(supabaseBucket).remove([record.imagePath]).catch(() => {}); } catch (e) {}
                } else if (record.imageStorage === 'local' && typeof record.imagePath === 'string' && fs.existsSync(record.imagePath)) {
                    try { await fsp.unlink(record.imagePath).catch(() => {}); } catch (e) {}
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
