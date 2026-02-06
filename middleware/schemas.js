const Joi = require('joi');

// Auth validations
exports.register_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100),
    email: Joi.string().email().required(),
    password: Joi.string().required().min(6),
    phone_number: Joi.string().required()
});

exports.login_schema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

exports.update_profile_schema = Joi.object({
    full_name: Joi.string().optional().min(3).max(100),
    phone_number: Joi.string().optional()
});

exports.register_pilgrim_schema = Joi.object({
    full_name: Joi.string().required().min(3).max(100),
    national_id: Joi.string().required(),
    medical_history: Joi.string().optional().max(500),
    email: Joi.string().optional().email(),
    age: Joi.number().optional().min(0).max(120), // Assuming reasonable age range
    gender: Joi.string().optional().valid('male', 'female', 'other')
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
    full_name: Joi.string().optional().min(3).max(100),
    national_id: Joi.string().optional(),
    phone_number: Joi.string().optional().allow(''),
    age: Joi.number().optional().min(0).max(120),
    gender: Joi.string().optional().valid('male', 'female', 'other'),
    medical_history: Joi.string().optional().allow('').max(500)
}).or('user_id', 'national_id');

// Hardware validations
exports.register_band_schema = Joi.object({
    serial_number: Joi.string().required(),
    imei: Joi.string().optional(),
    battery_percent: Joi.number().optional().min(0).max(100)
});

exports.assign_band_schema = Joi.object({
    serial_number: Joi.string().required(),
    user_id: Joi.string().required(),
    group_id: Joi.string().required()
});

exports.unassign_band_schema = Joi.object({
    user_id: Joi.string().required(),
    group_id: Joi.string().required()
});

exports.report_location_schema = Joi.object({
    serial_number: Joi.string().required(),
    lat: Joi.number().required(),
    lng: Joi.number().required(),
    battery_percent: Joi.number().optional().min(0).max(100)
});

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

