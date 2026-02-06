const rateLimit = require('express-rate-limit');

// General API limiter - 100 requests per 15 minutes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per windowMs
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict limiter for auth endpoints - 5 requests per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many login attempts, please try again later',
    skipSuccessfulRequests: true, // Don't count successful requests
});

// Public hardware endpoint - 1000 requests per minute (for wristbands)
const hardwareLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000,
    message: 'Hardware endpoint rate limit exceeded',
    standardHeaders: true,
    legacyHeaders: false,
});

// Search limiter - 30 requests per minute
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many search requests, please try again later',
});

module.exports = { generalLimiter, authLimiter, hardwareLimiter, searchLimiter };
