const Joi = require('joi');

/**
 * Validation Schemas for API Endpoints
 * Uses Joi for comprehensive request validation
 */

// Constants for reusable validation patterns
const SUPPORTED_LANGUAGES = ['en', 'ar', 'ur', 'fr', 'id', 'tr'];
const GENDERS = ['male', 'female', 'other'];
const ETHNICITIES = [
    'Arab',
    'South Asian',
    'Turkic',
    'Persian',
    'Malay/Indonesian',
    'African',
    'Kurdish',
    'Berber',
    'European Muslim',
    'Other'
];
const VISA_STATUSES = ['pending', 'issued', 'rejected', 'expired', 'unknown'];

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
const PASSWORD_MESSAGE = 'Password must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one number';
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

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

// Forgot Password — request reset code
exports.forgot_password_schema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
    })
});

// Reset Password — verify code and set new password
exports.reset_password_schema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
    }),
    code: Joi.string().required().length(6).messages({
        'string.length': 'Reset code must be 6 digits',
        'any.required': 'Reset code is required'
    }),
    new_password: Joi.string().required().min(SIMPLE_PASSWORD_MIN).messages({
        'string.min': `Password must be at least ${SIMPLE_PASSWORD_MIN} characters`,
        'any.required': 'New password is required'
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
    language: Joi.string().optional().valid(...SUPPORTED_LANGUAGES).default('en'),
    room_number: Joi.string().optional().allow('').max(50),
    bus_info: Joi.string().optional().allow('').max(120),
    hotel_name: Joi.string().optional().allow('').max(120),
    ethnicity: Joi.string().optional().valid(...ETHNICITIES),
    visa: Joi.object({
        visa_number: Joi.string().optional().allow('').max(64),
        issue_date: Joi.date().optional(),
        expiry_date: Joi.date().optional(),
        status: Joi.string().optional().valid(...VISA_STATUSES)
    }).optional()
});

exports.provision_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100),
    phone_number: Joi.string().required().min(3).max(30),
    national_id: Joi.string().optional().allow('', null),
    email: Joi.string().optional().allow('', null).email(),
    age: Joi.number().required().min(0).max(120),
    gender: Joi.string().optional().allow(null).valid(...GENDERS),
    language: Joi.string().required().valid(...SUPPORTED_LANGUAGES).default('en'),
    medical_history: Joi.string().optional().allow('', null).max(500),
    room_number: Joi.string().optional().allow('', null).max(50),
    room_id: Joi.string().optional().allow('', null),
    bus_info: Joi.string().optional().allow('', null).max(120),
    bus_id: Joi.string().optional().allow('', null),
    hotel_name: Joi.string().optional().allow('', null).max(120),
    hotel_id: Joi.string().optional().allow('', null),
    ethnicity: Joi.string().required().valid(...ETHNICITIES),
    visa: Joi.object({
        visa_number: Joi.string().optional().allow('', null).max(64),
        issue_date: Joi.date().optional().allow(null),
        expiry_date: Joi.date().optional().allow(null),
        status: Joi.string().required().valid(...VISA_STATUSES)
    }).required()
});

exports.provision_pilgrims_bulk_schema = Joi.object({
    pilgrims: Joi.array().items(exports.provision_pilgrim_schema).min(1).max(100).required()
});

exports.pilgrim_token_login_schema = Joi.object({
    token: Joi.string().trim().required(),
    device_id: Joi.string().trim().required().max(128)
});

// Register Invited Pilgrim (Invitation Link)
exports.register_invited_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100),
    password: Joi.string().required().min(PASSWORD_MIN_LENGTH).pattern(PASSWORD_PATTERN).messages({
        'string.min': PASSWORD_MESSAGE,
        'string.pattern.base': PASSWORD_MESSAGE
    }),
    token: Joi.string().trim().max(512).required().messages({
        'any.required': 'Invitation token is required'
    })
});

exports.update_pilgrim_details_schema = Joi.object({
    full_name: Joi.string().optional().min(3).max(100),
    phone_number: Joi.string().optional().allow(''),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid(...GENDERS),
    medical_history: Joi.string().optional().allow('').max(500),
    language: Joi.string().optional().valid(...SUPPORTED_LANGUAGES),
    room_number: Joi.string().optional().allow('').max(50),
    bus_info: Joi.string().optional().allow('').max(120),
    hotel_name: Joi.string().optional().allow('').max(120),
    ethnicity: Joi.string().optional().valid(...ETHNICITIES),
    visa: Joi.object({
        visa_number: Joi.string().optional().allow('').max(64),
        issue_date: Joi.date().optional(),
        expiry_date: Joi.date().optional(),
        status: Joi.string().optional().valid(...VISA_STATUSES)
    }).optional()
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
    }),
    battery_percent: Joi.number().optional().min(0).max(100).messages({
        'number.min': 'Battery percent must be between 0 and 100',
        'number.max': 'Battery percent must be between 0 and 100'
    }),
    battery: Joi.number().optional().min(0).max(100).messages({
        'number.min': 'Battery must be between 0 and 100',
        'number.max': 'Battery must be between 0 and 100'
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
    group_name: Joi.string().required().min(3).max(100),
    check_in_date: Joi.date().iso().optional(),
    check_out_date: Joi.date().iso().optional()
});

exports.update_group_schema = Joi.object({
    group_name: Joi.string().optional().min(3).max(100),
    check_in_date: Joi.date().iso().optional(),
    check_out_date: Joi.date().iso().optional()
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
    email: Joi.string().email().optional(),
    emails: Joi.array().items(Joi.string().email()).min(1).optional()
}).or('email', 'emails');

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

exports.request_moderator_schema = Joi.object({
    // No body needed, uses authenticated pilgrim's verified email
});

/**
 * Route Param and Query Validation
 */

exports.group_id_param_schema = Joi.object({
    group_id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.user_id_param_schema = Joi.object({
    user_id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.pilgrim_id_param_schema = Joi.object({
    pilgrim_id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.message_id_param_schema = Joi.object({
    message_id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.notification_id_param_schema = Joi.object({
    id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.invitation_id_param_schema = Joi.object({
    id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.area_id_param_schema = Joi.object({
    area_id: Joi.string().pattern(OBJECT_ID_PATTERN).required(),
    group_id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.reminder_id_param_schema = Joi.object({
    id: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.join_group_schema = Joi.object({
    group_code: Joi.string().trim().required().max(32)
});

exports.group_id_query_schema = Joi.object({
    group_id: Joi.string().pattern(OBJECT_ID_PATTERN).optional()
}).unknown(true);

exports.call_active_query_schema = Joi.object({
    callerId: Joi.string().pattern(OBJECT_ID_PATTERN).required()
}).unknown(true);

exports.answer_call_schema = Joi.object({
    callerId: Joi.string().pattern(OBJECT_ID_PATTERN).required(),
    answererId: Joi.string().pattern(OBJECT_ID_PATTERN).optional().allow('')
});

exports.decline_call_schema = Joi.object({
    callerId: Joi.string().pattern(OBJECT_ID_PATTERN).optional().allow(''),
    declinerId: Joi.string().pattern(OBJECT_ID_PATTERN).optional().allow(''),
    callRecordId: Joi.string().pattern(OBJECT_ID_PATTERN).optional().allow('')
}).or('callerId', 'callRecordId');

exports.create_reminder_schema = Joi.object({
    group_ids: Joi.array().items(Joi.string().pattern(OBJECT_ID_PATTERN)).optional(),
    target_type: Joi.string().valid('pilgrim', 'group', 'system', 'all_groups').required(),
    pilgrim_id: Joi.string().pattern(OBJECT_ID_PATTERN).when('target_type', {
        is: 'pilgrim',
        then: Joi.required(),
        otherwise: Joi.optional().allow(null, '')
    }),
    // Match mongoose reminder_model text maxlength: 500
    text: Joi.string().trim().min(1).max(500).required(),
    scheduled_at: Joi.date().iso().required(),
    repeat_count: Joi.number().integer().min(1).max(104).optional(),
    repeat_interval_min: Joi.number().integer().min(1).max(1440).optional(),
    is_daily: Joi.boolean().optional().default(false),
    times_per_day: Joi.number().integer().min(1).max(10).optional(),
    weekly_days: Joi.array().items(Joi.number().integer().min(1).max(7)).max(7).optional()
});

