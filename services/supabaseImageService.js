const env = require('../config/env');

let supabase = null;
const supabaseBucket = env.supabase.bucket || null;

// Initialize Supabase client
try {
    if (env.supabase.url && env.supabase.key) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(env.supabase.url, env.supabase.key);
    }
} catch (e) {
    console.error('Failed to initialize Supabase client:', e.message);
    supabase = null;
}

/**
 * ✅ Upload image to Supabase bucket and return public URL (REQUIRED)
 * @param {Buffer} buffer - Image file buffer
 * @param {string} destPath - Destination path in bucket (e.g., 'events-announcements/image.jpg')
 * @param {string} mimeType - File MIME type (e.g., 'image/jpeg')
 * @returns {Promise<{success: boolean, imageUrl: string|null, imagePath: string|null, imageStorage: string, error: string|null}>}
 * @throws {Error} - Throws if Supabase is not configured or upload fails
 */
async function uploadToSupabase(buffer, destPath, mimeType) {
    try {
        if (!supabase || !supabaseBucket) {
            throw new Error('Supabase not configured. Set SUPABASE_URL, SUPABASE_KEY, and SUPABASE_STORAGE_BUCKET.');
        }

        // Upload file to Supabase
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from(supabaseBucket)
            .upload(destPath, buffer, {
                contentType: mimeType,
                upsert: false
            });

        if (uploadError) {
            throw new Error(uploadError.message || 'Upload failed');
        }

        // Get public URL (Supabase v2 API)
        const { data: publicUrlData } = supabase.storage
            .from(supabaseBucket)
            .getPublicUrl(destPath);

        const publicUrl = publicUrlData?.publicUrl;

        if (!publicUrl) {
            throw new Error('Failed to generate public URL');
        }

        return {
            success: true,
            imageUrl: publicUrl,
            imagePath: destPath,
            imageStorage: 'supabase',
            error: null
        };
    } catch (err) {
        console.error('[SUPABASE] Upload error:', err.message);
        throw err;
    }
}

/**
 * ✅ Delete image from Supabase bucket
 * @param {string} imagePath - Path in bucket to delete
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function deleteFromSupabase(imagePath) {
    try {
        if (!supabase || !supabaseBucket || !imagePath) {
            return { success: false, error: 'Invalid parameters' };
        }

        const { error: deleteError } = await supabase.storage
            .from(supabaseBucket)
            .remove([imagePath]);

        if (deleteError) {
            console.warn('[SUPABASE] Delete warning:', deleteError.message);
            // Don't throw - it's OK if file doesn't exist
            return { success: true, error: null };
        }

        return { success: true, error: null };
    } catch (err) {
        console.error('[SUPABASE] Delete error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * ✅ Verify Supabase bucket configuration
 * @returns {Promise<{configured: boolean, message: string}>}
 */
async function verifySupabaseConfig() {
    try {
        if (!supabase || !supabaseBucket) {
            return {
                configured: false,
                message: 'Supabase not configured. Set SUPABASE_URL, SUPABASE_KEY, and SUPABASE_STORAGE_BUCKET.'
            };
        }

        // Try to list files (minimal operation to verify auth)
        const { data, error } = await supabase.storage
            .from(supabaseBucket)
            .list('', { limit: 1 });

        if (error && error.message.includes('not found')) {
            return {
                configured: false,
                message: `Bucket '${supabaseBucket}' does not exist or is not accessible.`
            };
        }

        if (error) {
            return {
                configured: false,
                message: `Supabase error: ${error.message}`
            };
        }

        return {
            configured: true,
            message: `✓ Supabase bucket '${supabaseBucket}' is accessible`
        };
    } catch (err) {
        return {
            configured: false,
            message: `Error verifying Supabase: ${err.message}`
        };
    }
}

/**
 * ✅ Generate public URL for existing Supabase image
 * @param {string} imagePath - Path in bucket
 * @returns {string|null}
 */
function getSupabasePublicUrl(imagePath) {
    if (!supabase || !supabaseBucket || !imagePath) {
        return null;
    }

    const { data } = supabase.storage
        .from(supabaseBucket)
        .getPublicUrl(imagePath);

    return data?.publicUrl || null;
}

/**
 * ✅ Check if URL is a Supabase URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isSupabaseUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Supabase storage URLs follow: https://[...]supabase.co/storage/v1/object/public/...
    return url.includes('supabase.co') && url.includes('/storage/');
}

/**
 * ✅ Check if URL is a local URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isLocalUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('/uploads/');
}

module.exports = {
    isConfigured: () => supabase && supabaseBucket,
    uploadToSupabase,
    deleteFromSupabase,
    verifySupabaseConfig,
    getSupabasePublicUrl,
    isSupabaseUrl,
    isLocalUrl
};
