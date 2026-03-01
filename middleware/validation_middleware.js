const { logger } = require('../config/logger');

/**
 * Joi validation middleware for request data
 * @param {Object} schema - Joi validation schema
 * @param {string} [target='body'] - Request property to validate ('body', 'params', 'query')
 * @returns {Function} Express middleware function
 */
const validate = (schema, target = 'body') => {
    return (req, res, next) => {
        const dataToValidate = req[target];
        
        if (!dataToValidate) {
            logger.warn(`Validation attempted on undefined req.${target}`);
            return res.status(400).json({
                success: false,
                message: "Invalid request data"
            });
        }

        const { error, value } = schema.validate(dataToValidate, { abortEarly: false });

        if (error) {
            // Format errors object: { field: "Error message" }
            const errors = {};
            error.details.forEach(detail => {
                // Remove quotes from field name in message if present
                errors[detail.path[0]] = detail.message.replace(/"/g, '');
            });

            // Log validation failures in debug mode
            if (process.env.LOG_LEVEL === 'debug') {
                logger.debug(`Validation failed on ${req.method} ${req.path}: ${JSON.stringify(errors)}`);
            }

            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: errors
            });
        }

        req[target] = value;
        next();
    };
};

module.exports = validate;
