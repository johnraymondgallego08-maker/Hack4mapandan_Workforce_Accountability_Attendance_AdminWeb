#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { admin, db } = require('../config/firebaseAdmin');
const eventModel = require('../models/eventAnnouncementModel');
const mimeLookup = (filename) => {
    const ext = String(path.extname(filename || '')).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'application/octet-stream';
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET;

if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_BUCKET) {
    console.error('Missing SUPABASE_URL, SUPABASE_KEY, or SUPABASE_STORAGE_BUCKET environment variables. Aborting.');
    process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrate() {
    console.log('Scanning Firestore events_announcements and local upload folder...');
    const snapshot = await db.collection('events_announcements').get();
    const docs = snapshot.docs.filter(d => {
        const data = d.data() || {};
        return !!data && !data.system && d.id !== 'bootstrap_config';
    });

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'events-announcements');
    const localFiles = await fs.readdir(uploadDir).catch(() => []);
    let migrated = 0;

    const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    for (const fileName of localFiles) {
        try {
            const localPath = path.join(uploadDir, fileName);
            const statOk = await fs.stat(localPath).then(() => true).catch(() => false);
            if (!statOk) continue;

            const base = fileName.replace(/\.[^/.]+$/, '');
            const fileSlug = slugify(base.replace(/-?\d{6,}$/, ''));

            // try to find a matching doc by filename or title slug
            let matchedDoc = null;
            for (const d of docs) {
                const data = d.data() || {};
                const titleSlug = slugify(data.title || '');
                const imagePath = String(data.imagePath || '');
                const imageUrl = String(data.imageUrl || '');

                if (imagePath && imagePath.includes(fileName)) { matchedDoc = d; break; }
                if (imageUrl && imageUrl.includes(fileName)) { matchedDoc = d; break; }
                if (titleSlug && (fileSlug.includes(titleSlug) || titleSlug.includes(fileSlug))) { matchedDoc = d; break; }
            }

            if (!matchedDoc) {
                console.warn(`[unmatched] No document matched for local file: ${fileName} — skipping`);
                continue;
            }

            const id = matchedDoc.id;
            const destPath = `events-announcements/${path.basename(localPath)}`;
            const contentType = mimeLookup(localPath);

            console.log(`[${id}] Uploading ${localPath} -> ${SUPABASE_BUCKET}/${destPath}`);
            const fileBuffer = await fs.readFile(localPath);
            const { data: uploadData, error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(destPath, fileBuffer, { contentType, upsert: false });
            if (uploadError) {
                console.error(`[${id}] Supabase upload failed:`, uploadError.message || uploadError);
                // Common cause: using a publishable/anon key while bucket has RLS enabled.
                console.warn('[migration] Supabase upload error may be due to bucket row-level security or insufficient key permissions. Use a service_role key or update bucket policies to allow uploads. Falling back to Firebase Storage if available.');

                // Try Firebase Storage fallback if configured
                try {
                    if (admin && admin.storage && process.env.FIREBASE_STORAGE_BUCKET) {
                        const gcsBucketName = process.env.FIREBASE_STORAGE_BUCKET;
                        const gcsBucket = admin.storage().bucket(gcsBucketName);
                        await gcsBucket.upload(localPath, { destination: destPath, metadata: { contentType } });
                        try { await gcsBucket.file(destPath).makePublic(); } catch (e) {}
                        const publicUrl = `https://storage.googleapis.com/${gcsBucketName}/${destPath}`;
                        await db.collection('events_announcements').doc(id).set({
                            imagePath: destPath,
                            imageUrl: publicUrl,
                            imageStorage: 'firebase',
                            updatedAt: admin.firestore.Timestamp.now()
                        }, { merge: true });
                        await fs.unlink(localPath).catch(() => {});
                        console.log(`[${id}] Migrated to Firebase Storage: ${publicUrl}`);
                        migrated++;
                        continue;
                    }
                } catch (fbErr) {
                    console.error(`[${id}] Firebase fallback failed:`, fbErr && fbErr.message ? fbErr.message : fbErr);
                }

                continue;
            }

            const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
            let publicUrl = publicData && (publicData.publicUrl || publicData.publicURL || publicData.public_url) ? (publicData.publicUrl || publicData.publicURL || publicData.public_url) : null;
            if (!publicUrl) {
                const { data: signedData, error: signErr } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(destPath, 60 * 60 * 24 * 365);
                if (signErr) {
                    console.error(`[${id}] Failed to create signed URL:`, signErr.message || signErr);
                } else {
                    publicUrl = signedData && signedData.signedUrl ? signedData.signedUrl : null;
                }
            }

            await db.collection('events_announcements').doc(id).set({
                imagePath: destPath,
                imageUrl: publicUrl,
                imageStorage: 'supabase',
                updatedAt: admin.firestore.Timestamp.now()
            }, { merge: true });

            // remove local file
            await fs.unlink(localPath).catch(() => {});
            console.log(`[${id}] Migrated to Supabase: ${publicUrl}`);
            migrated++;
        } catch (err) {
            console.error('Migration error for file', fileName, err.message || err);
        }
    }

    console.log(`Migration complete — ${migrated} files migrated.`);
    process.exit(0);
}

migrate().catch((err) => { console.error('Unexpected migration error', err); process.exit(1); });
