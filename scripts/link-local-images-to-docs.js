#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const { db, admin } = require('../config/firebaseAdmin');

(async function main() {
  console.log('Linking local uploaded images to Firestore documents (local-only).');
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'events-announcements');
  const files = await fs.readdir(uploadDir).catch(() => []);
  if (!files.length) {
    console.log('No local files found in', uploadDir);
    process.exit(0);
  }

  const snapshot = await db.collection('events_announcements').get();
  const docs = snapshot.docs.filter(d => {
    const data = d.data() || {};
    return !!data && !data.system && d.id !== 'bootstrap_config';
  });

  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let updated = 0;

  for (const fileName of files) {
    try {
      const localPath = path.join(uploadDir, fileName);
      const statOk = await fs.stat(localPath).then(() => true).catch(() => false);
      if (!statOk) continue;

      const base = fileName.replace(/\.[^/.]+$/, '');
      const fileSlug = slugify(base.replace(/-?\d{6,}$/, ''));

      let matched = null;
      for (const d of docs) {
        const data = d.data() || {};
        const titleSlug = slugify(data.title || '');
        const imagePath = String(data.imagePath || '');
        const imageUrl = String(data.imageUrl || '');

        if (imagePath && imagePath.includes(fileName)) { matched = d; break; }
        if (imageUrl && imageUrl.includes(fileName)) { matched = d; break; }
        if (titleSlug && (fileSlug.includes(titleSlug) || titleSlug.includes(fileSlug))) { matched = d; break; }
      }

      if (!matched) {
        console.log('[unmatched] No document matched for local file:', fileName);
        continue;
      }

      const id = matched.id;
      const localUrl = `/uploads/events-announcements/${fileName}`;

      await db.collection('events_announcements').doc(id).set({
        imagePath: localUrl,
        imageUrl: localUrl,
        imageStorage: 'local',
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      console.log(`[${id}] linked to ${localUrl}`);
      updated++;
    } catch (err) {
      console.error('Error linking file', fileName, err && err.message ? err.message : err);
    }
  }

  console.log(`Done. ${updated} files linked.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
