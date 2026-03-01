const jwt = require('jsonwebtoken');
const User = require('../models/user_model');
const { logger } = require('../config/logger');

// Track failed attempts for monitoring
const failedAttempts = new Map();

// Validate JWT secret on startup
if (!process.env.JWT_SECRET) {
    logger.error('CRITICAL: JWT_SECRET environment variable is not set. Authentication will fail.');
    process.exit(1);
}

/**
 * Authentication middleware - Verifies JWT token and attaches user info to request
 * @middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const protect = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn(`Authentication failed: Missing or invalid authorization header from ${req.ip}`);
        return res.status(401).json({ success: false, message: "Not authorized, no token provided" });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
        logger.warn(`Authentication failed: Empty token from ${req.ip}`);
        return res.status(401).json({ success: false, message: "Not authorized, no token provided" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach decoded token data to req.user
        // This includes id and role, avoiding unnecessary database lookups
        req.user = {
            id: decoded.id,
            role: decoded.role
        };

        // Log successful authentication (only in debug mode to avoid log spam)
        if (process.env.LOG_LEVEL === 'debug') {
            logger.debug(`User authenticated: ${decoded.id} (${decoded.role}) - ${req.method} ${req.path}`);
        }

        next();
    } catch (error) {
        // Track failed attempts
        const ip = req.ip;
        const attempts = failedAttempts.get(ip) || 0;
        failedAttempts.set(ip, attempts + 1);

        // Clear old entries after 1 hour
        setTimeout(() => failedAttempts.delete(ip), 3600000);

        // Log failed authentication with detailed error
        let errorMessage = "Invalid token";
        let statusCode = 401;

        if (error.name === 'TokenExpiredError') {
            errorMessage = "Token expired";
            logger.warn(`Authentication failed: Token expired from ${ip} (User: ${error.expiredAt})`);
        } else if (error.name === 'JsonWebTokenError') {
            errorMessage = "Invalid token format";
            logger.warn(`Authentication failed: Invalid token format from ${ip} - ${error.message}`);
        } else if (error.name === 'NotBeforeError') {
            errorMessage = "Token not yet valid";
            logger.warn(`Authentication failed: Token not active yet from ${ip}`);
        } else {
            logger.error(`Authentication error from ${ip}: ${error.message}`);
        }

        // Alert on suspicious activity
        if (attempts > 10) {
            logger.error(`SECURITY ALERT: ${attempts} failed authentication attempts from ${ip}`);
        }

        res.status(statusCode).json({ success: false, message: errorMessage });
    }
};

/**
 * Authorization middleware - Restricts access to specific roles
 * @middleware
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware function
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            logger.error('Authorization check failed: No user in request (protect middleware not called?)');
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        if (!roles.includes(req.user.role)) {
            logger.warn(`Authorization failed: User ${req.user.id} (${req.user.role}) attempted to access ${req.method} ${req.path} requiring roles: ${roles.join(', ')}`);
            return res.status(403).json({
                success: false,
                message: `Access denied. Required role: ${roles.join(' or ')}`
            });
        }

        next();
    };
};

/**
 * Admin-only authorization middleware
 * @middleware
 */
const verifyAdmin = authorize('admin');

module.exports = {
    protect,
    authorize,
    verifyAdmin
};