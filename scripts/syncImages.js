require('dotenv').config();
const { db } = require('../config/firebaseAdmin');
const https = require('https');
const fs = require('fs');
const path = require('path');

const EMPLOYEES_DIR = path.join(__dirname, '../public/employee_images');

if (!fs.existsSync(EMPLOYEES_DIR)) {
    fs.mkdirSync(EMPLOYEES_DIR, { recursive: true });
}

async function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function syncAll() {
    console.log('--- Starting Image Sync ---');
    
    const collections = ['employees', 'users'];
    
    for (const coll of collections) {
        console.log(`\nSyncing collection: ${coll}...`);
        const snapshot = await db.collection(coll).get();
        
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const id = doc.id;
            const name = data.name || data.displayName || data.email || 'Unknown';
            
            // Potential URL fields
            const url = data.img_url || data.imageUrl || data.photoUrl || data.image || data.profileImage ||
                        Object.values(data).find(v => typeof v === 'string' && v.startsWith('http') && v.includes('supabase'));

            if (url) {
                const folderName = `${name.replace(/[^a-z0-9]/gi, '_')}_${id}`;
                const folderPath = path.join(EMPLOYEES_DIR, folderName);
                
                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, { recursive: true });
                }

                const fileName = `profile.jpg`;
                const filePath = path.join(folderPath, fileName);

                console.log(`Syncing ${name} (${id})...`);
                try {
                    await downloadImage(url, filePath);
                    console.log(`✅ Saved to ${filePath}`);
                } catch (error) {
                    console.error(`❌ Failed to sync ${name}: ${error.message}`);
                }
            }
        }
    }
}

syncAll().then(() => {
    console.log('--- Sync Complete ---');
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
