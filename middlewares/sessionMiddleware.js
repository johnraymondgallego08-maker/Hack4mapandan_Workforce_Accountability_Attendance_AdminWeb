const crypto = require('crypto');
const env = require('../config/env');

const SESSION_COOKIE_NAME = 'admin.sid';
const FLASH_KEY = '__flash';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function parseCookies(header = '') {
    return String(header || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((acc, item) => {
            const index = item.indexOf('=');
            if (index === -1) return acc;
            const key = item.slice(0, index).trim();
            const value = item.slice(index + 1).trim();
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});
}

function toBase64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload) {
    return crypto
        .createHmac('sha256', env.sessionSecret)
        .update(payload)
        .digest('base64url');
}

function encodeSession(data) {
    const payload = toBase64Url(JSON.stringify(data));
    const signature = sign(payload);
    return `${payload}.${signature}`;
}

function decodeSession(rawCookie) {
    if (!rawCookie) return null;
    const [payload, signature] = String(rawCookie).split('.');
    if (!payload || !signature) return null;
    if (sign(payload) !== signature) return null;

    try {
        const parsed = JSON.parse(fromBase64Url(payload));
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
        return parsed;
    } catch (error) {
        return null;
    }
}

function appendSetCookie(res, cookieValue) {
    const current = res.getHeader('Set-Cookie');
    if (!current) {
        res.setHeader('Set-Cookie', [cookieValue]);
        return;
    }

    const nextValue = Array.isArray(current) ? current.concat(cookieValue) : [current, cookieValue];
    res.setHeader('Set-Cookie', nextValue);
}

function buildCookie(value, expiresAt) {
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax'
    ];

    if (expiresAt) {
        parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
    }

    if (env.isProduction) {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function buildExpiredCookie() {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${env.isProduction ? '; Secure' : ''}`;
}

function pickSerializableSession(session) {
    const serializable = {};

    Object.keys(session).forEach((key) => {
        const value = session[key];
        if (typeof value !== 'function') {
            serializable[key] = value;
        }
    });

    return serializable;
}

function attachSessionMethods(req, state) {
    const session = state.data;

    Object.defineProperty(session, 'save', {
        enumerable: false,
        value: (callback) => {
            state.touched = true;
            if (typeof callback === 'function') callback();
        }
    });

    Object.defineProperty(session, 'destroy', {
        enumerable: false,
        value: (callback) => {
            state.destroyed = true;
            state.touched = true;
            Object.keys(session).forEach((key) => delete session[key]);
            if (typeof callback === 'function') callback();
        }
    });

    Object.defineProperty(session, 'regenerate', {
        enumerable: false,
        value: (callback) => {
            state.destroyed = false;
            state.touched = true;
            Object.keys(session).forEach((key) => delete session[key]);
            if (typeof callback === 'function') callback();
        }
    });

    return session;
}

function sessionMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie || '');
    const parsedSession = decodeSession(cookies[SESSION_COOKIE_NAME]);
    const state = {
        destroyed: false,
        touched: false,
        data: (parsedSession && parsedSession.data) || {}
    };

    req.session = attachSessionMethods(req, state);

    const originalEnd = res.end.bind(res);
    res.end = function patchedEnd(...args) {
        if (state.destroyed) {
            appendSetCookie(res, buildExpiredCookie());
        } else {
            const payload = {
                data: pickSerializableSession(req.session),
                expiresAt: Date.now() + SESSION_TTL_MS
            };
            appendSetCookie(res, buildCookie(encodeSession(payload), payload.expiresAt));
        }

        return originalEnd(...args);
    };

    next();
}

function flashMiddleware(req, res, next) {
    req.flash = (type, message) => {
        req.session[FLASH_KEY] = req.session[FLASH_KEY] || {};

        if (typeof type === 'undefined') {
            const messages = { ...req.session[FLASH_KEY] };
            req.session[FLASH_KEY] = {};
            return messages;
        }

        if (typeof message === 'undefined') {
            const values = req.session[FLASH_KEY][type] || [];
            delete req.session[FLASH_KEY][type];
            return values;
        }

        req.session[FLASH_KEY][type] = req.session[FLASH_KEY][type] || [];
        req.session[FLASH_KEY][type].push(message);
        return req.session[FLASH_KEY][type];
    };

    next();
}

module.exports = {
    flashMiddleware,
    sessionMiddleware
};
