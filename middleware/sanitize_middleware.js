const { logger } = require('../config/logger');

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (value) => {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const sanitizeValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }

    if (!isPlainObject(value)) {
        return value;
    }

    const sanitized = {};

    for (const [key, nestedValue] of Object.entries(value)) {
        if (BLOCKED_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
            continue;
        }

        sanitized[key] = sanitizeValue(nestedValue);
    }

    return sanitized;
};

module.exports = (req, res, next) => {
    const originalBody = req.body;
    const originalQuery = req.query;
    const originalParams = req.params;

    req.body = sanitizeValue(req.body);
    req.query = sanitizeValue(req.query);
    req.params = sanitizeValue(req.params);

    if (JSON.stringify(req.body) !== JSON.stringify(originalBody) ||
        JSON.stringify(req.query) !== JSON.stringify(originalQuery) ||
        JSON.stringify(req.params) !== JSON.stringify(originalParams)) {
        logger.warn(`Sanitized potentially unsafe request input on ${req.method} ${req.path}`);
    }

    next();
};
