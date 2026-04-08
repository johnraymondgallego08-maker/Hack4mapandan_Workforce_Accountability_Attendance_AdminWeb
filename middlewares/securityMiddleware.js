const crypto = require('crypto');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 12;
const loginAttempts = new Map();

function generateCsrfToken() {
    return crypto.randomBytes(24).toString('hex');
}

function isJsonRequest(req) {
    const acceptHeader = String(req.headers.accept || '');
    const contentType = String(req.headers['content-type'] || '');
    return acceptHeader.includes('application/json') || contentType.includes('application/json');
}

function ensureCsrfToken(req, res, next) {
    if (req.session && !req.session.csrfToken) {
        req.session.csrfToken = generateCsrfToken();
    }

    res.locals.csrfToken = req.session ? req.session.csrfToken : '';
    next();
}

function verifyCsrfToken(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }

    const sessionToken = req.session ? req.session.csrfToken : null;
    const requestToken = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];

    if (sessionToken && requestToken && sessionToken === requestToken) {
        return next();
    }

    if (isJsonRequest(req)) {
        return res.status(403).json({ error: 'Security validation failed. Please refresh and try again.' });
    }

    if (req.flash) {
        req.flash('error', 'Your session security token expired. Please try again.');
    }
    return res.redirect('back');
}

function isMultipartFormRequest(req) {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    return contentType.includes('multipart/form-data');
}

function verifyCsrfTokenUnlessMultipart(req, res, next) {
    if (isMultipartFormRequest(req)) {
        return next();
    }

    return verifyCsrfToken(req, res, next);
}

function preventCaching(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
}

function loginRateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${req.ip || 'unknown'}:${String(req.body && (req.body.email || req.body.username || req.body.idToken || 'login'))}`;
    const current = loginAttempts.get(key);

    if (current && current.expiresAt <= now) {
        loginAttempts.delete(key);
    }

    const activeAttempt = loginAttempts.get(key);
    if (activeAttempt && activeAttempt.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfterSeconds = Math.max(1, Math.ceil((activeAttempt.expiresAt - now) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
            error: 'Too many login attempts. Please wait a few minutes and try again.',
            retryAfter: retryAfterSeconds
        });
    }

    res.on('finish', () => {
        if (res.statusCode >= 400) {
            const entry = loginAttempts.get(key);
            if (entry && entry.expiresAt > now) {
                entry.count += 1;
                return;
            }

            loginAttempts.set(key, {
                count: 1,
                expiresAt: now + LOGIN_WINDOW_MS
            });
            return;
        }

        loginAttempts.delete(key);
    });

    next();
}

function clearLoginRateLimit(req) {
    const key = `${req.ip || 'unknown'}:${String(req.body && (req.body.email || req.body.username || req.body.idToken || 'login'))}`;
    loginAttempts.delete(key);
}

function requireEmergencyAccess(req, res, next) {
    if (process.env.ALLOW_EMERGENCY_ADMIN_FIX === 'true') {
        return next();
    }

    return res.status(403).send('Emergency admin fix route is disabled. Set ALLOW_EMERGENCY_ADMIN_FIX=true to enable it intentionally.');
}

module.exports = {
    clearLoginRateLimit,
    ensureCsrfToken,
    generateCsrfToken,
    isMultipartFormRequest,
    loginRateLimiter,
    preventCaching,
    requireEmergencyAccess,
    verifyCsrfToken,
    verifyCsrfTokenUnlessMultipart
};
