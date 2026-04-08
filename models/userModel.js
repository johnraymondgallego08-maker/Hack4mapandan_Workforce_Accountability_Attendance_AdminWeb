const { db } = require('../config/firebaseAdmin');
const fs = require('fs');
const path = require('path');
const usersCollection = db.collection('employees');
const EMPLOYEE_IMAGES_DIR = path.join(__dirname, '../public/employee_images');
const EMPLOYEE_DEFAULT_FIELDS = {
    status: 'Active',
    employmentStatus: '',
    workSchedule: '',
    supervisor: ''
};

function isEmployeeUser(user) {
    const role = String(user && user.role ? user.role : '').trim().toLowerCase();
    const adminLikeRoles = new Set([
        'admin',
        'administrator',
        'system admin',
        'system_admin',
        'super admin',
        'superadmin'
    ]);
    return !adminLikeRoles.has(role);
}

function mergeUserRecord(existing = {}, incoming = {}) {
    const merged = { ...existing, ...incoming };

    if (!incoming.name && existing.name) merged.name = existing.name;
    if (!incoming.email && existing.email) merged.email = existing.email;
    if (!incoming.role && existing.role) merged.role = existing.role;
    if (!incoming.status && existing.status) merged.status = existing.status;
    if (!incoming.photoUrl && existing.photoUrl) merged.photoUrl = existing.photoUrl;
    if (!incoming.profileImage && existing.profileImage) merged.profileImage = existing.profileImage;

    return merged;
}

function getMissingEmployeeDefaults(data = {}) {
    const missingFields = {};

    for (const [key, defaultValue] of Object.entries(EMPLOYEE_DEFAULT_FIELDS)) {
        if (data[key] === undefined) {
            missingFields[key] = defaultValue;
        }
    }

    return missingFields;
}

function normalizeImagePath(value) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image')) {
        return trimmed;
    }

    const normalized = trimmed.replace(/\\/g, '/');
    if (normalized.startsWith('/employee_images/')) return normalized;
    if (normalized.startsWith('employee_images/')) return `/${normalized}`;

    const publicIndex = normalized.toLowerCase().indexOf('/public/employee_images/');
    if (publicIndex >= 0) return normalized.slice(publicIndex + '/public'.length);
    if (normalized.toLowerCase().startsWith('public/employee_images/')) return normalized.slice('public'.length);

    return null;
}

function findLocalProfileImage(userId = '') {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId || !fs.existsSync(EMPLOYEE_IMAGES_DIR)) return null;

    const entries = fs.readdirSync(EMPLOYEE_IMAGES_DIR, { withFileTypes: true });
    const matchedFolder = entries.find(entry => entry.isDirectory() && entry.name.endsWith(`_${safeUserId}`));
    if (!matchedFolder) return null;

    for (const fileName of ['profile.jpg', 'profile.jpeg', 'profile.png', 'profile.webp']) {
        const candidatePath = path.join(EMPLOYEE_IMAGES_DIR, matchedFolder.name, fileName);
        if (fs.existsSync(candidatePath)) {
            return `/employee_images/${matchedFolder.name}/${fileName}`;
        }
    }

    return null;
}

function resolveUserPhoto(id, data = {}, existingPhoto = null) {
    const imageCandidates = [
        existingPhoto,
        data.photoUrl,
        data.profileImage,
        data.img_url,
        data.imageUrl,
        data.image,
        data.url,
        data.capturedImage,
        ...Object.values(data).filter(value => typeof value === 'string')
    ];

    for (const candidate of imageCandidates) {
        const normalized = normalizeImagePath(candidate);
        if (normalized) return normalized;
    }

    return findLocalProfileImage(id);
}

exports.getAllUsers = async () => {
    try {
        const snapshot = await usersCollection.get(); // employees
        const usersSnapshot = await db.collection('users').get(); // users
        const adminSnapshot = await db.collection('Admin').get(); // Admin
        const employeeBackfills = [];

        // Merge collections: start with users, then overlay Admin, then employees
        const combinedUsers = new Map();

        usersSnapshot.forEach(doc => {
            combinedUsers.set(doc.id, { id: doc.id, ...doc.data() });
        });

        adminSnapshot.forEach(doc => {
            const existing = combinedUsers.get(doc.id) || {};
            combinedUsers.set(doc.id, mergeUserRecord(existing, {
                id: doc.id,
                ...doc.data(),
                role: doc.data().role || existing.role || 'admin',
                _fromAdminCollection: true
            }));
        });

        snapshot.forEach(doc => {
            const existing = combinedUsers.get(doc.id) || {};
            const employeeData = doc.data() || {};
            const missingDefaults = getMissingEmployeeDefaults(employeeData);

            if (Object.keys(missingDefaults).length > 0) {
                employeeBackfills.push(usersCollection.doc(doc.id).set(missingDefaults, { merge: true }));
            }

            combinedUsers.set(doc.id, mergeUserRecord(existing, {
                id: doc.id,
                ...missingDefaults,
                ...employeeData
            }));
        });

        if (employeeBackfills.length > 0) {
            await Promise.allSettled(employeeBackfills);
        }

        // Process all users, downloading missing images in parallel
        const userPromises = [];
        for (const data of combinedUsers.values()) {
            userPromises.push((async () => {
                const id = data.id;

                const photoUrl = resolveUserPhoto(id, data);
                return { id, ...data, photoUrl: photoUrl || null, profileImage: data.profileImage || photoUrl || null };
            })());
        }

        return Promise.all(userPromises);
    } catch (error) {
        console.error("Error getting all users:", error);
        return [];
    }
};

exports.getUserById = async (id) => {
    const doc = await usersCollection.doc(id).get();
    let data = doc.exists ? doc.data() : null;
    let source = 'employees';

    if (doc.exists && data) {
        const missingDefaults = getMissingEmployeeDefaults(data);
        if (Object.keys(missingDefaults).length > 0) {
            await usersCollection.doc(id).set(missingDefaults, { merge: true });
            data = { ...missingDefaults, ...data };
        }
    }

    // Check users collection if not found in employees
    if (!data) {
        const userDoc = await db.collection('users').doc(id).get();
        if (userDoc.exists) {
            data = userDoc.data();
            source = 'users';
        }
    }

    // Check Admin collection if not found elsewhere
    if (!data) {
        const adminDoc = await db.collection('Admin').doc(id).get();
        if (adminDoc.exists) {
            data = adminDoc.data();
            source = 'Admin';
        }
    }

    // Overlay Admin fields when available so admin accounts don't fall back to unknown metadata
    const adminDoc = await db.collection('Admin').doc(id).get();
    if (adminDoc.exists) {
        const adminData = adminDoc.data();
        data = { ...(data || {}), ...adminData, role: adminData.role || (data && data.role) || 'admin' };
    }

    if (!data) return null;

    let remoteUrl = resolveUserPhoto(id, data);

    // If in employees but no photo, check users collection for photo as fallback
    if (!remoteUrl && source === 'employees') {
        const userDoc = await db.collection('users').doc(id).get();
        if (userDoc.exists) {
            const imgData = userDoc.data();
            remoteUrl = resolveUserPhoto(id, imgData, remoteUrl);
        }
    }

    return { id, ...data, photoUrl: remoteUrl || null, profileImage: data.profileImage || remoteUrl || null };
};

exports.updateUser = async (id, data) => {
    // 1. Update employees collection (use set+merge to handle cases where doc might be missing)
    await usersCollection.doc(id).set(data, { merge: true });

    // 2. Sync with Admin collection if user exists there (ensures login/auth data is consistent)
    const adminRef = db.collection('Admin').doc(id);
    const adminDoc = await adminRef.get();
    if (adminDoc.exists) {
        await adminRef.set(data, { merge: true });
    }

    // 3. Sync with users collection if user exists there
    const usersRef = db.collection('users').doc(id);
    const usersDoc = await usersRef.get();
    if (usersDoc.exists) {
        await usersRef.set(data, { merge: true });
    }
    return true;
};

exports.deleteUser = async (id) => {
    // Attempt to delete from all potential collections to ensure "unknown" or "synced" users are removed
    try {
        await usersCollection.doc(id).delete(); // employees
        await db.collection('users').doc(id).delete(); // users
        await db.collection('Admin').doc(id).delete(); // Admin

        // Also clean up local folder if it exists (handles "Unknown" users or local artifacts)
        if (fs.existsSync(EMPLOYEE_IMAGES_DIR)) {
            const files = fs.readdirSync(EMPLOYEE_IMAGES_DIR);
            for (const file of files) {
                if (file.endsWith(`_${id}`)) {
                    fs.rmSync(path.join(EMPLOYEE_IMAGES_DIR, file), { recursive: true, force: true });
                }
            }
        }

        return true;
    } catch (error) {
        console.error("Error in deleteUser model:", error);
        return false;
    }
};

// This function is useful for checking roles, but not for password auth anymore.
exports.getUserByEmail = async (email) => {
    if (!email) return null;
    const lowerCaseEmail = email.toLowerCase();
    const snapshot = await usersCollection.where('email', '==', lowerCaseEmail).limit(1).get();
    if (snapshot.empty) {
        return null;
    }
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
};

exports.getEmployeeUsers = async () => {
    const [users, adminSnapshot] = await Promise.all([
        exports.getAllUsers(),
        db.collection('Admin').get()
    ]);

    const adminIds = new Set(adminSnapshot.docs.map(doc => doc.id));
    return users.filter(user => {
        const userId = String(user && user.id ? user.id : '').trim();
        const isAdminCollectionUser = Boolean(user && user._fromAdminCollection) || adminIds.has(userId);
        return !isAdminCollectionUser && isEmployeeUser(user);
    });
};
