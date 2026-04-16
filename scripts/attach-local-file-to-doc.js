#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { db, admin } = require('../config/firebaseAdmin');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/attach-local-file-to-doc.js <docId> <filename>');
    process.exit(1);
  }

  const [docId, filename] = args;
  const uploadPath = path.join(process.cwd(), 'public', 'uploads', 'events-announcements', filename);

  if (!fs.existsSync(uploadPath)) {
    console.error('File not found:', uploadPath);
    process.exit(1);
  }

  const localUrl = `/uploads/events-announcements/${filename}`;

  await db.collection('events_announcements').doc(docId).set({
    imagePath: localUrl,
    imageUrl: localUrl,
    imageStorage: 'local',
    updatedAt: admin.firestore.Timestamp.now()
  }, { merge: true });

  console.log(`Attached ${filename} to document ${docId} as ${localUrl}`);
  process.exit(0);
}

main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
