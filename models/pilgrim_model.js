const mongoose = require('mongoose');

const pilgrim_schema = new mongoose.Schema({
    full_name: { type: String, required: true },
    email: { type: String, sparse: true }, // Optional email
    password: { type: String, sparse: true }, // Password for app login (hashed)
    national_id: { type: String, unique: true, sparse: true }, // National/State ID for pilgrims
    phone_number: { type: String, unique: true, sparse: true }, // Each user has unique phone number
    age: { type: Number, min: 0 }, // Age of the user, optional
    gender: { type: String, enum: ['male', 'female', 'other'] }, // Gender of the user, optional
    profile_picture: { type: String, default: null },
    medical_history: String, // Optional medical information for pilgrims

    // Live Tracking Fields (Replaces Hardware Band)
    current_latitude: { type: Number },
    current_longitude: { type: Number },
    last_location_update: { type: Date },
    battery_percent: { type: Number, min: 0, max: 100 },

    active: { type: Boolean, default: true }, // Track if account is active
    created_at: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Pilgrim', pilgrim_schema);