const jwt = require('jsonwebtoken');
const { logger } = require('../config/logger');

/**
 * Socket.IO Authentication Middleware
 * Validates JWT token before allowing WebSocket connection
 * Attaches userId and role to socket.data for authorization
 */
const socketAuthMiddleware = async (socket, next) => {
    try {
        // Get token from handshake auth or query params (for mobile compatibility)
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        
        if (!token) {
            logger.warn(`[Socket Auth] Connection rejected: No token provided from ${socket.handshake.address}`);
            return next(new Error('Authentication required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decoded.id || !decoded.role) {
            logger.warn(`[Socket Auth] Connection rejected: Invalid token payload from ${socket.handshake.address}`);
            return next(new Error('Invalid token payload'));
        }

        // Attach user info to socket data (available in all event handlers)
        socket.data.userId = decoded.id;
        socket.data.role = decoded.role;
        socket.data.authenticatedAt = Date.now();

        logger.info(`[Socket Auth] User authenticated: ${decoded.id} (${decoded.role}) - Socket: ${socket.id}`);
        next();

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            logger.warn(`[Socket Auth] Connection rejected: Token expired from ${socket.handshake.address}`);
            return next(new Error('Token expired'));
        }
        
        if (err.name === 'JsonWebTokenError') {
            logger.warn(`[Socket Auth] Connection rejected: Invalid token from ${socket.handshake.address}`);
            return next(new Error('Invalid token'));
        }

        logger.error(`[Socket Auth] Unexpected error:`, err);
        next(new Error('Authentication failed'));
    }
};

module.exports = socketAuthMiddleware;
