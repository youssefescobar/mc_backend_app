const Redis = require('ioredis');
const { logger } = require('../config/logger');

/**
 * Redis Cache Service
 * Provides caching utilities for frequently accessed data
 */
class CacheService {
    constructor() {
        // Redis client for caching (separate from Socket.IO adapter)
        this.client = new Redis(process.env.REDIS_URL, {
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });

        this.client.on('connect', () => {
            logger.info('[Cache] Redis cache connected');
        });

        this.client.on('error', (err) => {
            logger.error('[Cache] Redis cache error:', err);
        });

        this.client.on('ready', () => {
            logger.info('[Cache] Redis cache ready');
        });

        // Default TTL values (in seconds)
        this.TTL = {
            USER: 300,          // 5 minutes - user data changes infrequently
            GROUP: 180,         // 3 minutes - group data moderate changes
            CALL_HISTORY: 60,   // 1 minute - call data changes frequently
            NOTIFICATION: 120,  // 2 minutes
            MESSAGE: 30,        // 30 seconds - messages are real-time
            ONLINE_USERS: 60    // 1 minute - online status changes
        };
    }

    /**
     * Generate cache key with prefix
     * @param {string} prefix - Key prefix (e.g., 'user', 'group')
     * @param {string} id - Entity ID
     * @returns {string} - Cache key
     */
    key(prefix, id) {
        return `${prefix}:${id}`;
    }

    /**
     * Get cached value
     * @param {string} key - Cache key
     * @returns {Promise<any>} - Parsed JSON value or null
     */
    async get(key) {
        try {
            const value = await this.client.get(key);
            if (!value) return null;
            
            return JSON.parse(value);
        } catch (err) {
            logger.error(`[Cache] Get error for key ${key}:`, err);
            return null; // Fail gracefully - return null on error
        }
    }

    /**
     * Set cached value with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache (will be JSON stringified)
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<boolean>} - Success status
     */
    async set(key, value, ttl = this.TTL.USER) {
        try {
            await this.client.setex(key, ttl, JSON.stringify(value));
            return true;
        } catch (err) {
            logger.error(`[Cache] Set error for key ${key}:`, err);
            return false;
        }
    }

    /**
     * Delete cached value
     * @param {string} key - Cache key or array of keys
     * @returns {Promise<number>} - Number of keys deleted
     */
    async delete(key) {
        try {
            if (Array.isArray(key)) {
                if (key.length === 0) return 0;
                return await this.client.del(...key);
            }
            return await this.client.del(key);
        } catch (err) {
            logger.error(`[Cache] Delete error for key ${key}:`, err);
            return 0;
        }
    }

    /**
     * Delete all keys matching a pattern
     * @param {string} pattern - Key pattern (e.g., 'user:*')
     * @returns {Promise<number>} - Number of keys deleted
     */
    async deletePattern(pattern) {
        try {
            const keys = await this.client.keys(pattern);
            if (keys.length === 0) return 0;
            
            return await this.client.del(...keys);
        } catch (err) {
            logger.error(`[Cache] Delete pattern error for ${pattern}:`, err);
            return 0;
        }
    }

    /**
     * Check if key exists
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} - True if exists
     */
    async exists(key) {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (err) {
            logger.error(`[Cache] Exists error for key ${key}:`, err);
            return false;
        }
    }

    /**
     * Get or set pattern: Check cache, if miss execute callback and cache result
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Async function to fetch data on cache miss
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<any>} - Cached or freshly fetched data
     */
    async getOrSet(key, fetchFn, ttl = this.TTL.USER) {
        // Try to get from cache first
        const cached = await this.get(key);
        if (cached !== null) {
            logger.debug(`[Cache] HIT: ${key}`);
            return cached;
        }

        // Cache miss - fetch data
        logger.debug(`[Cache] MISS: ${key}`);
        try {
            const data = await fetchFn();
            
            // Don't cache null/undefined
            if (data !== null && data !== undefined) {
                await this.set(key, data, ttl);
            }
            
            return data;
        } catch (err) {
            logger.error(`[Cache] getOrSet fetch error for ${key}:`, err);
            throw err; // Re-throw to let caller handle
        }
    }

    /**
     * Increment a counter
     * @param {string} key - Cache key
     * @param {number} amount - Amount to increment (default: 1)
     * @returns {Promise<number>} - New value
     */
    async incr(key, amount = 1) {
        try {
            return await this.client.incrby(key, amount);
        } catch (err) {
            logger.error(`[Cache] Incr error for key ${key}:`, err);
            return 0;
        }
    }

    /**
     * Set expiration on a key
     * @param {string} key - Cache key
     * @param {number} seconds - Seconds until expiration
     * @returns {Promise<boolean>} - Success status
     */
    async expire(key, seconds) {
        try {
            return await this.client.expire(key, seconds) === 1;
        } catch (err) {
            logger.error(`[Cache] Expire error for key ${key}:`, err);
            return false;
        }
    }

    /**
     * Get cache statistics
     * @returns {Promise<Object>} - Cache stats
     */
    async getStats() {
        try {
            const info = await this.client.info('stats');
            const memory = await this.client.info('memory');
            
            return {
                connected: this.client.status === 'ready',
                stats: info,
                memory: memory
            };
        } catch (err) {
            logger.error('[Cache] Get stats error:', err);
            return { connected: false, error: err.message };
        }
    }

    /**
     * Flush all cache (use with caution!)
     * @returns {Promise<boolean>} - Success status
     */
    async flush() {
        try {
            await this.client.flushdb();
            logger.warn('[Cache] Cache flushed!');
            return true;
        } catch (err) {
            logger.error('[Cache] Flush error:', err);
            return false;
        }
    }

    /**
     * Close Redis connection gracefully
     * @returns {Promise<void>}
     */
    async disconnect() {
        try {
            await this.client.quit();
            logger.info('[Cache] Redis cache disconnected');
        } catch (err) {
            logger.error('[Cache] Disconnect error:', err);
        }
    }
}

// Export singleton instance
const cacheService = new CacheService();
module.exports = cacheService;
