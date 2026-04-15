const { db } = require('../config/firebaseAdmin');

const COLLECTION_NAME = 'events_announcements';
const BOOTSTRAP_DOC_ID = '__bootstrap__';

function toValidDate(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') {
        const converted = value.toDate();
        return Number.isNaN(converted.getTime()) ? null : converted;
    }
    const converted = new Date(value);
    return Number.isNaN(converted.getTime()) ? null : converted;
}

function formatDateTime(value) {
    const date = toValidDate(value);
    if (!date) return null;
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatScheduleLabel(data = {}) {
    const dateValue = toValidDate(data.eventDate || data.publishDate || data.date);
    const timeValue = String(data.eventTime || '').trim();
    const parts = [];

    if (dateValue) {
        parts.push(dateValue.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }));
    }

    if (timeValue) {
        parts.push(timeValue);
    }

    return parts.join(' at ') || 'No schedule set';
}

async function ensureCollectionReady() {
    const bootstrapRef = db.collection(COLLECTION_NAME).doc(BOOTSTRAP_DOC_ID);
    const bootstrapSnap = await bootstrapRef.get();

    if (!bootstrapSnap.exists) {
        await bootstrapRef.set({
            system: true,
            label: 'events-announcements-bootstrap',
            createdAt: new Date()
        });
    }
}

exports.getAll = async () => {
    try {
        await ensureCollectionReady();
        const snapshot = await db.collection(COLLECTION_NAME).get();

        return snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((record) => !record.system && record.id !== BOOTSTRAP_DOC_ID)
            .map((record) => ({
                ...record,
                createdAtLabel: formatDateTime(record.createdAt || record.updatedAt),
                scheduleLabel: formatScheduleLabel(record)
            }))
            .sort((a, b) => {
                const aDate = toValidDate(a.eventDate || a.publishDate || a.createdAt) || 0;
                const bDate = toValidDate(b.eventDate || b.publishDate || b.createdAt) || 0;
                return bDate - aDate;
            });
    } catch (error) {
        console.error('Error loading events and announcements:', error);
        return [];
    }
};

exports.create = async (data = {}) => {
    await ensureCollectionReady();
    const payload = {
        type: data.type || 'announcement',
        title: data.title || '',
        summary: data.summary || '',
        content: data.content || '',
        eventDate: data.eventDate || null,
        eventTime: data.eventTime || '',
        location: data.location || '',
        status: data.status || 'Published',
        imageUrl: data.imageUrl || null,
        imagePath: data.imagePath || null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const docRef = await db.collection(COLLECTION_NAME).add(payload);
    return { id: docRef.id, ...payload };
};

exports.getById = async (id) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return null;

    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) return null;

    const data = doc.data() || {};
    if (data.system) return null;

    return { id: doc.id, ...data };
};

exports.delete = async (id) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return false;

    await db.collection(COLLECTION_NAME).doc(id).delete();
    return true;
};
