const Joi = require('joi');

/**
 * Socket Event Validation Schemas
 * Defines expected structure for each socket event
 */

const schemas = {
    // Call events
    'call-offer': Joi.object({
        to: Joi.string().required().length(24).hex(), // MongoDB ObjectId
        channelName: Joi.string().required().pattern(/^call_\d+$/)
    }),

    'call-answer': Joi.object({
        to: Joi.string().required().length(24).hex()
    }),

    'call-declined': Joi.object({
        to: Joi.string().required().length(24).hex()
    }),

    'call-end': Joi.object({
        to: Joi.string().required().length(24).hex()
    }),

    'call-cancel': Joi.object({
        to: Joi.string().required().length(24).hex()
    }),

    'call-busy': Joi.object({
        to: Joi.string().required().length(24).hex()
    }),

    // Group events
    'join_group': Joi.string().required().length(24).hex(),

    'leave_group': Joi.string().required().length(24).hex(),

    // Location updates
    'update_location': Joi.object({
        groupId: Joi.string().required().length(24).hex(),
        pilgrimId: Joi.string().required().length(24).hex(),
        lat: Joi.number().required().min(-90).max(90),
        lng: Joi.number().required().min(-180).max(180),
        battery_percent: Joi.number().optional().min(0).max(100)
    }),

    // SOS alerts
    'sos_alert': Joi.object({
        groupId: Joi.string().required().length(24).hex(),
        pilgrimId: Joi.string().required().length(24).hex(),
        lat: Joi.number().required().min(-90).max(90),
        lng: Joi.number().required().min(-180).max(180),
        message: Joi.string().optional().max(500)
    }),

    // Navigation beacons
    'mod_nav_beacon': Joi.object({
        moderatorId: Joi.string().required().length(24).hex(),
        moderatorName: Joi.string().required().max(100),
        groupId: Joi.string().required().length(24).hex(),
        enabled: Joi.boolean().required(),
        lat: Joi.number().when('enabled', { is: true, then: Joi.number().required().min(-90).max(90), otherwise: Joi.number().optional() }),
        lng: Joi.number().when('enabled', { is: true, then: Joi.number().required().min(-180).max(180), otherwise: Joi.number().optional() })
    }),

    'pilgrim_nav_beacon': Joi.object({
        pilgrimId: Joi.string().required().length(24).hex(),
        pilgrimName: Joi.string().required().max(100),
        groupId: Joi.string().required().length(24).hex(),
        enabled: Joi.boolean().required(),
        lat: Joi.number().when('enabled', { is: true, then: Joi.number().required().min(-90).max(90), otherwise: Joi.number().optional() }),
        lng: Joi.number().when('enabled', { is: true, then: Joi.number().required().min(-180).max(180), otherwise: Joi.number().optional() })
    }),

    // Typing indicators
    'typing': Joi.object({
        groupId: Joi.string().required().length(24).hex(),
        isTyping: Joi.boolean().required()
    }),

    // Message status updates
    'message_read': Joi.object({
        messageId: Joi.string().required().length(24).hex(),
        groupId: Joi.string().required().length(24).hex()
    })
};

/**
 * Validate socket event data against schema
 * @param {string} eventName - Name of the event
 * @param {any} data - Data to validate
 * @returns {Object} - { valid: boolean, error: string|null, value: any }
 */
function validateSocketEvent(eventName, data) {
    const schema = schemas[eventName];
    
    if (!schema) {
        // No validation schema defined - allow by default
        return { valid: true, value: data, error: null };
    }

    const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true // Remove unknown fields
    });

    if (error) {
        const errorMessage = error.details.map(d => d.message).join(', ');
        return { valid: false, error: errorMessage, value: null };
    }

    return { valid: true, value, error: null };
}

module.exports = {
    schemas,
    validateSocketEvent
};
