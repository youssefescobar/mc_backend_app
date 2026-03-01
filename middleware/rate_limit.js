const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger');

// Helper to extract IP for logging (handles proxies and IPv6)
const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip;
};

// Custom handler for rate limit exceeded
const rateLimitHandler = (req, res) => {
    const ip = getClientIp(req);
    logger.warn(`Rate limit exceeded for ${ip} on ${req.method} ${req.path}`);
    res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
    });
};

// General API limiter - 200 requests per 15 minutes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    handler: rateLimitHandler,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/' || req.path === '/health', // Skip health checks
    validate: { trustProxy: false }, // Disable trust proxy validation warning
});

// Login limiter - 5 requests per 15 minutes
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    handler: (req, res) => {
        const ip = getClientIp(req);
        logger.warn(`Login rate limit exceeded for ${ip}`);
        res.status(429).json({
            success: false,
            message: 'Too many login attempts, please try again in 15 minutes',
        });
    },
    skipSuccessfulRequests: true, // Don't count successful logins
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable trust proxy validation warning
});

// Register limiter - 10 requests per hour
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    handler: (req, res) => {
        const ip = getClientIp(req);
        logger.warn(`Registration rate limit exceeded for ${ip}`);
        res.status(429).json({
            success: false,
            message: 'Too many registration attempts, please try again later',
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable trust proxy validation warning
});

// Auth limiter (for other auth endpoints) - 20 requests per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    handler: (req, res) => {
        const ip = getClientIp(req);
        logger.warn(`Auth rate limit exceeded for ${ip} on ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Too many requests, please try again later',
        });
    },
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable trust proxy validation warning
});

// Search limiter - 30 requests per minute
const searchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    handler: (req, res) => {
        const ip = getClientIp(req);
        logger.warn(`Search rate limit exceeded for ${ip}`);
        res.status(429).json({
            success: false,
            message: 'Too many search requests, please try again later',
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable trust proxy validation warning
});

module.exports = { 
    generalLimiter, 
    authLimiter, 
    loginLimiter, 
    registerLimiter, 
    searchLimiter 
};
