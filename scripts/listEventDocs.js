#!/usr/bin/env node
require('dotenv').config();
const { db } = require('../config/firebaseAdmin');

async function list() {
  const snapshot = await db.collection('events_announcements').get();
  console.log('Found', snapshot.size, 'documents');
  for (const doc of snapshot.docs) {
    const d = doc.data() || {};
    console.log(doc.id, '|', (d.title || '').replace(/\n/g,' '), '| imagePath=', d.imagePath || '', '| imageUrl=', d.imageUrl || '');
  }
  process.exit(0);
}

list().catch(err => { console.error(err); process.exit(1); });
