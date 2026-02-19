const mongoose = require('mongoose');

const pilgrim_schema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, sparse: true, unique: true }, // Optional email, unique if provided
    email_verified: { type: Boolean, default: false }, // Track email verification status
    password: { type: String, required: true }, // Password for app login (hashed)
    national_id: { type: String, required: true, unique: true }, // National/State ID for pilgrims
    phone_number: { type: String, required: true, unique: true }, // Each user has unique phone number
    age: { type: Number, min: 0 }, // Age of the user, optional
    gender: { type: String, enum: ['male', 'female', 'other'] }, // Gender of the user, optional
    profile_picture: { type: String, default: null },
    medical_history: String, // Optional medical information for pilgrims
    role: { type: String, enum: ['pilgrim', 'moderator'], default: 'pilgrim' }, // Can be upgraded to moderator
    language: { type: String, default: 'en' }, // Language preference (e.g., 'en', 'ar', 'ur', etc.)
    fcm_token: { type: String, default: null }, // FCM Token for Push Notifications

    // Live Tracking Fields (Replaces Hardware Band)
    current_latitude: { type: Number },
    current_longitude: { type: Number },
    last_location_update: { type: Date },
    battery_percent: { type: Number, min: 0, max: 100 },

    active: { type: Boolean, default: true }, // Track if account is enabled/disabled (for Admin/Mod use)
    is_online: { type: Boolean, default: false }, // Track if user is currently connected via socket
    last_active_at: { type: Date, default: Date.now }, // Last time the pilgrim was active/connected
    created_at: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // Optional - only for moderator-created pilgrims
});

module.exports = mongoose.model('Pilgrim', pilgrim_schema);