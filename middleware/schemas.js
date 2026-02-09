const Joi = require('joi');

// Auth validations - Pilgrim Registration
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
    password: Joi.string().required().min(6).messages({
        'string.min': 'Password must be at least 6 characters long',
        'any.required': 'Password is required'
    }),
    email: Joi.string().email().optional().allow('').messages({
        'string.email': 'Please provide a valid email address'
    }),
    medical_history: Joi.string().optional().allow('').max(500),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid('male', 'female', 'other')
});

exports.login_schema = Joi.object({
    identifier: Joi.string().required().messages({
        'string.empty': 'Email, national ID, or phone number is required',
        'any.required': 'Email, national ID, or phone number is required'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required'
    })
});

exports.register_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100).messages({ 'any.required': 'Full name is required' }),
    national_id: Joi.string().required().messages({ 'any.required': 'National ID is required' }),
    medical_history: Joi.string().optional().max(500),
    email: Joi.string().optional().email().messages({ 'string.email': 'Invalid email format' }),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid('male', 'female', 'other')
});

exports.update_profile_schema = Joi.object({
    full_name: Joi.string().optional().min(3).max(100),
    phone_number: Joi.string().optional(),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid('male', 'female', 'other'),
    medical_history: Joi.string().optional().allow('').max(500)
});

// Group validations
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

// Email verification schemas
exports.verify_email_schema = Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().required().length(6)
});

exports.resend_verification_schema = Joi.object({
    email: Joi.string().email().required()
});

// Invitation schema
exports.send_invitation_schema = Joi.object({
    email: Joi.string().email().required()
});

// Communication validations
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

// Email management for pilgrims
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

// Moderator request
exports.request_moderator_schema = Joi.object({
    // No body needed, uses authenticated user
});

