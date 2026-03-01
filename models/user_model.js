const mongoose = require('mongoose');

/**
 * Unified User Model
 * Handles all user types: admin, moderator, and pilgrim
 * Consolidates previously separate User and Pilgrim models
 */
const user_schema = new mongoose.Schema({
    // ========================================
    // Core Identity Fields (All Users)
    // ========================================
    full_name: { 
        type: String, 
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 100
    },
    email: { 
        type: String, 
        sparse: true,  // Allows null/undefined, unique if provided
        unique: true,
        lowercase: true,
        trim: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // Basic email validation
    },
    email_verified: { 
        type: Boolean, 
        default: false 
    },
    password: { 
        type: String, 
        required: true 
    },
    phone_number: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true
    },
    user_type: {
        type: String,
        enum: ['admin', 'moderator', 'pilgrim'],
        required: true,
        default: 'pilgrim',
        index: true
    },
    
    // ========================================
    // Pilgrim-Specific Fields
    // ========================================
    national_id: { 
        type: String, 
        sparse: true,
        unique: true,
        trim: true,
        // Required only for pilgrims, validated in controllers
    },
    age: { 
        type: Number, 
        min: 0, 
        max: 120 
    },
    gender: { 
        type: String, 
        enum: ['male', 'female', 'other'] 
    },
    medical_history: { 
        type: String,
        maxlength: 500
    },
    language: { 
        type: String, 
        default: 'en',
        enum: ['en', 'ar', 'ur', 'fr', 'id', 'tr']
    },
    
    // ========================================
    // Profile & Media
    // ========================================
    profile_picture: { 
        type: String, 
        default: null 
    },
    
    // ========================================
    // Push Notifications
    // ========================================
    fcm_token: { 
        type: String, 
        default: null 
    },
    
    // ========================================
    // Location Tracking (All Users)
    // ========================================
    current_latitude: { 
        type: Number,
        min: -90,
        max: 90
    },
    current_longitude: { 
        type: Number,
        min: -180,
        max: 180
    },
    last_location_update: { 
        type: Date 
    },
    battery_percent: { 
        type: Number, 
        min: 0, 
        max: 100 
    },
    
    // ========================================
    // Account Status & Activity
    // ========================================
    active: { 
        type: Boolean, 
        default: true,
        index: true
    },
    is_online: { 
        type: Boolean, 
        default: false 
    },
    last_active_at: { 
        type: Date, 
        default: Date.now 
    },
    
    // ========================================
    // Administrative Tracking
    // ========================================
    created_by: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    created_at: { 
        type: Date, 
        default: Date.now 
    }
});

// ========================================
// Indexes for Performance
// ========================================
// Note: email, phone_number, and national_id already have unique indexes from field definitions
user_schema.index({ user_type: 1, active: 1 });
user_schema.index({ current_latitude: 1, current_longitude: 1 }); // For geospatial queries
user_schema.index({ is_online: 1, user_type: 1 });

// ========================================
// Virtual Properties
// ========================================

// Backward compatibility - map 'role' to 'user_type'
user_schema.virtual('role').get(function() {
    return this.user_type;
});

// Ensure virtuals are included in JSON
user_schema.set('toJSON', { virtuals: true });
user_schema.set('toObject', { virtuals: true });

// ========================================
// Instance Methods
// ========================================

/**
 * Check if user is a pilgrim
 */
user_schema.methods.isPilgrim = function() {
    return this.user_type === 'pilgrim';
};

/**
 * Check if user is a moderator or admin
 */
user_schema.methods.isModerator = function() {
    return this.user_type === 'moderator' || this.user_type === 'admin';
};

/**
 * Check if user is an admin
 */
user_schema.methods.isAdmin = function() {
    return this.user_type === 'admin';
};

/**
 * Update location
 */
user_schema.methods.updateLocation = function(latitude, longitude, battery) {
    this.current_latitude = latitude;
    this.current_longitude = longitude;
    this.last_location_update = new Date();
    if (battery !== undefined) {
        this.battery_percent = battery;
    }
    return this.save();
};

module.exports = mongoose.model('User', user_schema);