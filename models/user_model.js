const mongoose = require('mongoose');

const user_schema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ['admin', 'moderator', 'pilgrim'],
        default: 'pilgrim'
    },
    profile_picture: { type: String, default: null },
    fcm_token: { type: String, default: null }, // FCM Token for Push Notifications
    phone_number: { type: String, required: true, unique: true }, // Each user has unique phone number
    active: { type: Boolean, default: true }, // Track if account is enabled/disabled (for Admin/Mod use)
    is_online: { type: Boolean, default: false }, // Track if user is currently connected via socket
    last_active_at: { type: Date, default: Date.now }, // Last time the user was active/connected

    // Location Tracking (for Moderators)
    current_latitude: { type: Number },
    current_longitude: { type: Number },
    last_location_update: { type: Date },

    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', user_schema);