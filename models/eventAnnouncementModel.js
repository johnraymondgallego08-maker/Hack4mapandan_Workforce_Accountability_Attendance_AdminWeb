const { db, admin } = require('../config/firebaseAdmin');

const COLLECTION_NAME = 'events_announcements';
const BOOTSTRAP_DOC_ID = 'bootstrap_config';
const APP_TIMEZONE = 'Asia/Manila';

function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'draft') return 'Draft';
    if (normalized === 'public' || normalized === 'published') return 'Public';
    return 'Public';
}

function isPublishedStatus(value) {
    return normalizeStatus(value) === 'Public';
}

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
        timeZone: APP_TIMEZONE,
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
            timeZone: APP_TIMEZONE,
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

function toInputDate(value) {
    const date = toValidDate(value);
    if (!date) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function mapEventRecord(record = {}) {
    return {
        ...record,
        status: normalizeStatus(record.status),
        isPublished: isPublishedStatus(record.status),
        createdAtLabel: formatDateTime(record.createdAt || record.updatedAt),
        scheduleLabel: formatScheduleLabel(record),
        eventDateInput: toInputDate(record.eventDate)
    };
}

async function ensureCollectionReady() {
    const bootstrapRef = db.collection(COLLECTION_NAME).doc(BOOTSTRAP_DOC_ID);
    const bootstrapSnap = await bootstrapRef.get();

    if (!bootstrapSnap.exists) {
        await bootstrapRef.set({
            system: true,
            label: 'events-announcements-bootstrap',
            createdAt: admin.firestore.Timestamp.now()
        });
    }
}

function toFirestoreTimestamp(value) {
    if (!value) return null;
    if (value.toDate && typeof value.toDate === 'function') return value; // already a Timestamp
    if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return admin.firestore.Timestamp.fromDate(parsed);
    return null;
}

exports.getAll = async () => {
    try {
        await ensureCollectionReady();
        const snapshot = await db.collection(COLLECTION_NAME).get();

        return snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((record) => !record.system && record.id !== BOOTSTRAP_DOC_ID)
            .map((record) => mapEventRecord(record))
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
    const normalizedStatus = normalizeStatus(data.status);
    const payload = {
        type: data.type || 'announcement',
        title: data.title || '',
        summary: data.summary || '',
        content: data.content || '',
        eventDate: toFirestoreTimestamp(data.eventDate) || null,
        eventTime: data.eventTime || '',
        location: data.location || '',
        status: normalizedStatus,
        imageUrl: data.imageUrl || null,
        imagePath: data.imagePath || null,
        imageStorage: data.imageStorage || null,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
    };

    if (isPublishedStatus(normalizedStatus)) {
        payload.publishedAt = admin.firestore.Timestamp.now();
    }

    const docRef = await db.collection(COLLECTION_NAME).add(payload);
    return mapEventRecord({ id: docRef.id, ...payload });
};

exports.getById = async (id) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return null;

    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) return null;

    const data = doc.data() || {};
    if (data.system) return null;

    return mapEventRecord({
        id: doc.id,
        ...data
    });
};

exports.update = async (id, data = {}) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return false;

    const normalizedStatus = normalizeStatus(data.status);
    const payload = {
        type: data.type || 'announcement',
        title: data.title || '',
        summary: data.summary || '',
        content: data.content || '',
        eventDate: toFirestoreTimestamp(data.eventDate) || null,
        eventTime: data.eventTime || '',
        location: data.location || '',
        status: normalizedStatus,
        updatedAt: admin.firestore.Timestamp.now()
    };

    if (Object.prototype.hasOwnProperty.call(data, 'imageUrl')) {
        payload.imageUrl = data.imageUrl || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'imagePath')) {
        payload.imagePath = data.imagePath || null;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'imageStorage')) {
        payload.imageStorage = data.imageStorage || null;
    }
    if (isPublishedStatus(normalizedStatus)) {
        payload.publishedAt = toFirestoreTimestamp(data.publishedAt) || admin.firestore.Timestamp.now();
    }

    await db.collection(COLLECTION_NAME).doc(id).set(payload, { merge: true });
    return true;
};

exports.delete = async (id) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return false;

    await db.collection(COLLECTION_NAME).doc(id).delete();
    return true;
};

exports.toggleStatus = async (id, nextStatus) => {
    if (!id || id === BOOTSTRAP_DOC_ID) return false;

    const normalizedStatus = normalizeStatus(nextStatus);
    await db.collection(COLLECTION_NAME).doc(id).set({
        status: normalizedStatus,
        ...(isPublishedStatus(normalizedStatus) ? { publishedAt: admin.firestore.Timestamp.now() } : {}),
        updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    return true;
};

exports.isPublishedStatus = isPublishedStatus;
