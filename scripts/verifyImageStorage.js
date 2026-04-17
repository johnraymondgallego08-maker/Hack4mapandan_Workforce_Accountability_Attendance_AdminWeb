#!/usr/bin/env node

/**
 * Event Image Storage Verification Script
 * Checks Supabase configuration and image storage setup
 * Run with: node scripts/verifyImageStorage.js
 */

require('dotenv').config();
const supabaseImageService = require('../services/supabaseImageService');
const { db, admin } = require('../config/firebaseAdmin');

const COLLECTION_NAME = 'events_announcements';

async function verifySupabaseConfig() {
    console.log('\n📋 Checking Supabase Configuration...');
    const config = await supabaseImageService.verifySupabaseConfig();
    console.log(`   ${config.configured ? '✅' : '❌'} ${config.message}`);
    return config.configured;
}

async function verifyFirebaseConnection() {
    console.log('\n📋 Checking Firebase Connection...');
    try {
        const snapshot = await db.collection(COLLECTION_NAME).limit(1).get();
        console.log('   ✅ Firebase Firestore connected and accessible');
        return true;
    } catch (err) {
        console.log(`   ❌ Firebase error: ${err.message}`);
        return false;
    }
}

async function scanEventImages() {
    console.log('\n📋 Scanning Event Images in Firebase...');
    try {
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('__name__', '!=', 'bootstrap_config')
            .limit(20)
            .get();

        if (snapshot.empty) {
            console.log('   ℹ️  No events found in database');
            return;
        }

        const events = snapshot.docs.map(doc => ({
            id: doc.id,
            title: doc.data().title,
            imageUrl: doc.data().imageUrl,
            imagePath: doc.data().imagePath,
            imageStorage: doc.data().imageStorage || 'unknown'
        }));

        console.log(`   Found ${events.length} events:`);
        events.forEach((evt, idx) => {
            const urlType = supabaseImageService.isSupabaseUrl(evt.imageUrl)
                ? '🌐 Supabase'
                : supabaseImageService.isLocalUrl(evt.imageUrl)
                    ? '💾 Local'
                    : '❓ Unknown';

            console.log(`   ${idx + 1}. ${evt.title}`);
            console.log(`      Storage: ${evt.imageStorage} | URL Type: ${urlType}`);
            console.log(`      URL: ${evt.imageUrl || '(none)'}`);
        });
    } catch (err) {
        console.log(`   ❌ Error scanning events: ${err.message}`);
    }
}

async function validateImageUrls() {
    console.log('\n📋 Validating Image URLs...');
    try {
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('imageUrl', '!=', null)
            .limit(10)
            .get();

        if (snapshot.empty) {
            console.log('   ℹ️  No images found');
            return;
        }

        let supabaseCount = 0,
            localCount = 0,
            invalidCount = 0;

        snapshot.docs.forEach(doc => {
            const url = doc.data().imageUrl;
            if (supabaseImageService.isSupabaseUrl(url)) supabaseCount++;
            else if (supabaseImageService.isLocalUrl(url)) localCount++;
            else invalidCount++;
        });

        console.log(`   ✅ Supabase URLs: ${supabaseCount}`);
        console.log(`   ✅ Local URLs: ${localCount}`);
        if (invalidCount > 0) {
            console.log(`   ⚠️  Invalid/Unknown URLs: ${invalidCount}`);
        }
    } catch (err) {
        console.log(`   ❌ Error validating URLs: ${err.message}`);
    }
}

async function printEnvironmentStatus() {
    console.log('\n📋 Environment Variables Status:');
    console.log(`   ${process.env.SUPABASE_URL ? '✅' : '❌'} SUPABASE_URL`);
    console.log(`   ${process.env.SUPABASE_KEY ? '✅' : '❌'} SUPABASE_KEY`);
    console.log(`   ${process.env.SUPABASE_STORAGE_BUCKET ? '✅' : '❌'} SUPABASE_STORAGE_BUCKET: ${process.env.SUPABASE_STORAGE_BUCKET || '(not set)'}`);
    console.log(`   ${process.env.FIREBASE_PROJECT_ID ? '✅' : '❌'} FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID || '(not set)'}`);
}

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Event Image Storage Verification');
    console.log('═══════════════════════════════════════════════════════');

    printEnvironmentStatus();

    const supabaseOk = await verifySupabaseConfig();
    const firebaseOk = await verifyFirebaseConnection();

    if (firebaseOk) {
        await scanEventImages();
        await validateImageUrls();
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' Summary:');
    console.log(`   ${supabaseOk ? '✅ Supabase configured' : '⚠️  Supabase NOT configured (using local storage)'}`);
    console.log(`   ${firebaseOk ? '✅ Firebase connected' : '❌ Firebase NOT connected'}`);
    console.log('═══════════════════════════════════════════════════════\n');

    process.exit(firebaseOk ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
