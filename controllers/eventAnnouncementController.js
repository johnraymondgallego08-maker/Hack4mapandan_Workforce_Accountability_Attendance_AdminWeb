const fs = require('fs');
const path = require('path');
const eventAnnouncementModel = require('../models/eventAnnouncementModel');

const EVENT_UPLOAD_DIR = path.join(__dirname, '../public/uploads/events-announcements');

function ensureEventUploadDir() {
    if (!fs.existsSync(EVENT_UPLOAD_DIR)) {
        fs.mkdirSync(EVENT_UPLOAD_DIR, { recursive: true });
    }
}

function sanitizeFileName(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^a-z0-9_-]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

exports.manageEvents = async (req, res) => {
    try {
        const records = await eventAnnouncementModel.getAll();
        res.render('manage-events', { records });
    } catch (error) {
        console.error('Error loading events and announcements page:', error);
        req.flash('error', 'Failed to load events and announcements.');
        res.redirect('/');
    }
};

exports.createEvent = async (req, res) => {
    try {
        ensureEventUploadDir();

        const type = String(req.body.type || 'announcement').trim().toLowerCase() === 'event' ? 'event' : 'announcement';
        const title = String(req.body.title || '').trim();
        const summary = String(req.body.summary || '').trim();
        const content = String(req.body.content || '').trim();
        const eventDate = String(req.body.eventDate || '').trim();
        const eventTime = String(req.body.eventTime || '').trim();
        const location = String(req.body.location || '').trim();
        const status = String(req.body.status || 'Published').trim() || 'Published';

        if (!title) {
            req.flash('error', 'Title is required.');
            return res.redirect('/manage-events');
        }

        let imagePath = null;
        let imageUrl = null;

        if (req.file) {
            const extension = path.extname(req.file.originalname || req.file.filename || '').toLowerCase() || '.jpg';
            const safeBase = sanitizeFileName(title) || `entry-${Date.now()}`;
            const fileName = `${safeBase}-${Date.now()}${extension}`;
            const targetPath = path.join(EVENT_UPLOAD_DIR, fileName);

            fs.renameSync(req.file.path, targetPath);
            imagePath = targetPath;
            imageUrl = `/uploads/events-announcements/${fileName}`;
        }

        await eventAnnouncementModel.create({
            type,
            title,
            summary,
            content,
            eventDate: eventDate || null,
            eventTime,
            location,
            status,
            imagePath,
            imageUrl
        });

        req.flash('success', `${type === 'event' ? 'Event' : 'Announcement'} created successfully.`);
    } catch (error) {
        console.error('Error creating event or announcement:', error);
        req.flash('error', 'Failed to create the record.');
    }

    res.redirect('/manage-events');
};

exports.deleteEvent = async (req, res) => {
    try {
        const record = await eventAnnouncementModel.getById(req.params.id);
        if (!record) {
            req.flash('error', 'Record not found.');
            return res.redirect('/manage-events');
        }

        await eventAnnouncementModel.delete(req.params.id);

        if (record.imagePath && fs.existsSync(record.imagePath)) {
            fs.unlinkSync(record.imagePath);
        }

        req.flash('success', 'Record deleted successfully.');
    } catch (error) {
        console.error('Error deleting event or announcement:', error);
        req.flash('error', 'Failed to delete the record.');
    }

    res.redirect('/manage-events');
};
