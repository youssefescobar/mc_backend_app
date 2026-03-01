/**
 * Standardized API response helpers
 */

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {Object} [data={}] - Response data
 */
const sendSuccess = (res, statusCode, message, data = {}) => {
    res.status(statusCode).json({
        success: true,
        message,
        ...data
    });
};

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} [errors=null] - Validation errors object
 */
const sendError = (res, statusCode, message, errors = null) => {
    const response = {
        success: false,
        message
    };
    
    if (errors) {
        response.errors = errors;
    }
    
    res.status(statusCode).json(response);
};

/**
 * Send validation error response
 * @param {Object} res - Express response object
 * @param {Object} errors - Validation errors object
 */
const sendValidationError = (res, errors) => {
    sendError(res, 400, 'Validation Error', errors);
};

/**
 * Send server error response
 * @param {Object} res - Express response object
 * @param {Object} logger - Winston logger instance
 * @param {string} context - Error context for logging
 * @param {Error} error - Error object
 */
const sendServerError = (res, logger, context, error) => {
    logger.error(`${context}: ${error.message}`, { stack: error.stack });
    sendError(res, 500, 'Server error');
};

/**
 * JWT token expiration time
 */
const JWT_EXPIRATION = '14d'; // 14 days instead of 30

module.exports = {
    sendSuccess,
    sendError,
    sendValidationError,
    sendServerError,
    JWT_EXPIRATION
};
