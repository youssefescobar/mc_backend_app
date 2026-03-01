const Joi = require('joi');

/**
 * Validation Schemas for API Endpoints
 * Uses Joi for comprehensive request validation
 */

// Constants for reusable validation patterns
const SUPPORTED_LANGUAGES = ['en', 'ar', 'ur', 'fr', 'id', 'tr'];
const GENDERS = ['male', 'female', 'other'];

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
const PASSWORD_MESSAGE = 'Password must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one number';

// Simple password for backward compatibility (used where users can't set complex passwords)
const SIMPLE_PASSWORD_MIN = 6;

/**
 * Auth Validations
 */

// Pilgrim Registration (Public Signup)
exports.register_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100).messages({
        'string.empty': 'Full name is required',
        'string.min': 'Full name must be at least 3 characters',
        'any.required': 'Full name is required'
    }),
    national_id: Joi.string().required().messages({
        'string.empty': 'National ID is required',
        'any.required': 'National ID is required'
    }),
    phone_number: Joi.string().required().messages({
        'string.empty': 'Phone number is required',
        'any.required': 'Phone number is required'
    }),
    password: Joi.string().required().min(PASSWORD_MIN_LENGTH).pattern(PASSWORD_PATTERN).messages({
        'string.min': PASSWORD_MESSAGE,
        'string.pattern.base': PASSWORD_MESSAGE,
        'any.required': 'Password is required'
    }),
    email: Joi.string().email().optional().allow('').messages({
        'string.email': 'Please provide a valid email address'
    }),
    medical_history: Joi.string().optional().allow('').max(500),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid(...GENDERS),
    language: Joi.string().optional().valid(...SUPPORTED_LANGUAGES).default('en')
});

// Login (Universal)
exports.login_schema = Joi.object({
    identifier: Joi.string().required().messages({
        'string.empty': 'Email, national ID, or phone number is required',
        'any.required': 'Email, national ID, or phone number is required'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required'
    })
});

// Register Pilgrim (By Moderator/Admin)
exports.register_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100).messages({ 
        'any.required': 'Full name is required' 
    }),
    national_id: Joi.string().required().messages({ 
        'any.required': 'National ID is required' 
    }),
    phone_number: Joi.string().optional().allow(''),
    medical_history: Joi.string().optional().allow('').max(500),
    email: Joi.string().optional().allow('').email().messages({ 
        'string.email': 'Invalid email format' 
    }),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid(...GENDERS),
    password: Joi.string().optional().min(SIMPLE_PASSWORD_MIN).messages({
        'string.min': `Password must be at least ${SIMPLE_PASSWORD_MIN} characters`
    }),
    language: Joi.string().optional().valid(...SUPPORTED_LANGUAGES).default('en')
});

// Register Invited Pilgrim (Invitation Link)
exports.register_invited_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100),
    password: Joi.string().required().min(PASSWORD_MIN_LENGTH).pattern(PASSWORD_PATTERN).messages({
        'string.min': PASSWORD_MESSAGE,
        'string.pattern.base': PASSWORD_MESSAGE
    }),
    token: Joi.string().required().messages({
        'any.required': 'Invitation token is required'
    })
});

/**
 * Profile Management Validations
 */

exports.update_profile_schema = Joi.object({
    full_name: Joi.string().optional().min(3).max(100),
    phone_number: Joi.string().optional(),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid(...GENDERS),
    medical_history: Joi.string().optional().allow('').max(500),
    language: Joi.string().optional().valid(...SUPPORTED_LANGUAGES)
});

exports.update_language_schema = Joi.object({
    language: Joi.string().required().valid(...SUPPORTED_LANGUAGES)
});

exports.update_location_schema = Joi.object({
    latitude: Joi.number().required().min(-90).max(90).messages({
        'any.required': 'Latitude is required',
        'number.min': 'Latitude must be between -90 and 90',
        'number.max': 'Latitude must be between -90 and 90'
    }),
    longitude: Joi.number().required().min(-180).max(180).messages({
        'any.required': 'Longitude is required',
        'number.min': 'Longitude must be between -180 and 180',
        'number.max': 'Longitude must be between -180 and 180'
    })
});

exports.update_fcm_token_schema = Joi.object({
    fcm_token: Joi.string().required().messages({
        'any.required': 'FCM token is required'
    })
});

/**
 * Group Management Validations
 */

exports.create_group_schema = Joi.object({
    group_name: Joi.string().required().min(3).max(100)
});

exports.update_group_schema = Joi.object({
    group_name: Joi.string().optional().min(3).max(100)
});

exports.add_pilgrim_schema = Joi.object({
    user_id: Joi.string().optional(),
    identifier: Joi.string().optional(),
}).or('user_id', 'identifier');

/**
 * Messaging Validations
 */

exports.send_message_schema = Joi.object({
    group_id: Joi.string().required(),
    type: Joi.string().valid('text', 'voice', 'image', 'tts', 'meetpoint').default('text'),
    content: Joi.string().when('type', {
        is: Joi.valid('text', 'tts'),
        then: Joi.string().required().min(1).max(1000),
        otherwise: Joi.string().optional().allow('')
    }),
    is_urgent: Joi.boolean().optional().default(false),
    original_text: Joi.string().when('type', {
        is: 'tts',
        then: Joi.string().required(),
        otherwise: Joi.string().optional().allow('')
    }),
    duration: Joi.number().optional().min(0).max(300), // Max 5 minutes
    recipient_id: Joi.string().optional() // For individual messages
});

/**
 * Alert/Notification Validations
 */

exports.send_alert_schema = Joi.object({
    group_id: Joi.string().required(),
    message_text: Joi.string().required().min(1).max(500)
});

exports.send_individual_alert_schema = Joi.object({
    user_id: Joi.string().required(),
    message_text: Joi.string().required().min(1).max(500)
});

exports.user_action_schema = Joi.object({
    user_id: Joi.string().required()
});

/**
 * Email Verification Validations
 */

exports.verify_email_schema = Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().required().length(6)
});

exports.resend_verification_schema = Joi.object({
    email: Joi.string().email().required()
});

/**
 * Invitation Validations
 */

exports.send_invitation_schema = Joi.object({
    email: Joi.string().email().required()
});

/**
 * Communication/Session Validations
 */

exports.start_session_schema = Joi.object({
    group_id: Joi.string().required().messages({ 'any.required': 'Group ID is required' }),
    type: Joi.string().valid('voice_call', 'video_call', 'walkie_talkie').required().messages({
        'any.only': 'Type must be one of: voice_call, video_call, walkie_talkie',
        'any.required': 'Session type is required'
    })
});

exports.join_session_schema = Joi.object({
    session_id: Joi.string().required().messages({ 'any.required': 'Session ID is required' })
});

exports.end_session_schema = Joi.object({
    session_id: Joi.string().required().messages({ 'any.required': 'Session ID is required' })
});

/**
 * Email Management for Pilgrims
 */

exports.add_email_schema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
    })
});

exports.send_email_verification_schema = Joi.object({
    // No body needed, uses authenticated user's email
});

exports.verify_pilgrim_email_schema = Joi.object({
    code: Joi.string().required().length(6).messages({
        'string.length': 'Verification code must be 6 digits',
        'any.required': 'Verification code is required'
    })
});

/**
 * Moderator Request Validation
 */


