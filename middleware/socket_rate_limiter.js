const { logger } = require('../config/logger');

/**
 * Per-Socket Rate Limiter
 * Prevents individual sockets from spamming events
 */
class SocketRateLimiter {
    constructor() {
        // Map: socketId -> Map: eventName -> Array of timestamps
        this.history = new Map();
        
        // Cleanup old entries every 60 seconds
        setInterval(() => this.cleanup(), 60000);
    }

    /**
     * Check if event is within rate limit
     * @param {string} socketId - Socket.IO socket ID
     * @param {string} eventName - Event name being checked
     * @param {number} maxPerMinute - Maximum events allowed per minute
     * @returns {boolean} - True if allowed, false if rate limited
     */
    check(socketId, eventName, maxPerMinute = 60) {
        const now = Date.now();
        const key = `${socketId}:${eventName}`;
        
        // Get or create history for this socket
        if (!this.history.has(socketId)) {
            this.history.set(socketId, new Map());
        }
        
        const socketHistory = this.history.get(socketId);
        const eventHistory = socketHistory.get(eventName) || [];
        
        // Remove timestamps older than 60 seconds
        const recentEvents = eventHistory.filter(timestamp => now - timestamp < 60000);
        
        // Check if limit exceeded
        if (recentEvents.length >= maxPerMinute) {
            logger.warn(`[Rate Limit] Socket ${socketId} exceeded limit for '${eventName}': ${recentEvents.length}/${maxPerMinute} per minute`);
            return false;
        }
        
        // Add current timestamp and update history
        recentEvents.push(now);
        socketHistory.set(eventName, recentEvents);
        
        return true;
    }

    /**
     * Remove rate limit history for a disconnected socket
     * @param {string} socketId - Socket.IO socket ID
     */
    removeSocket(socketId) {
        this.history.delete(socketId);
    }

    /**
     * Cleanup old socket entries (sockets that disconnected without cleanup)
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        for (const [socketId, socketHistory] of this.history.entries()) {
            // Check if any recent activity
            let hasRecentActivity = false;
            
            for (const eventHistory of socketHistory.values()) {
                if (eventHistory.some(timestamp => now - timestamp < maxAge)) {
                    hasRecentActivity = true;
                    break;
                }
            }
            
            // Remove if no recent activity
            if (!hasRecentActivity) {
                this.history.delete(socketId);
            }
        }
    }

    /**
     * Get current stats for a socket (for debugging)
     * @param {string} socketId
     * @returns {Object}
     */
    getStats(socketId) {
        const socketHistory = this.history.get(socketId);
        if (!socketHistory) return {};
        
        const stats = {};
        for (const [eventName, timestamps] of socketHistory.entries()) {
            stats[eventName] = timestamps.length;
        }
        return stats;
    }
}

// Singleton instance
const rateLimiter = new SocketRateLimiter();

module.exports = rateLimiter;
