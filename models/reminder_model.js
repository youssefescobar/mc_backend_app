const mongoose = require('mongoose');

const reminder_schema = new mongoose.Schema({
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    group_ids: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    }],
    // 'pilgrim' = one specific pilgrim, 'group' = everyone in selected groups, 'system' = everyone
    target_type: {
        type: String,
        enum: ['pilgrim', 'group', 'system', 'all_groups'],
        required: true
    },
    pilgrim_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    text: {
        type: String,
        required: true,
        maxlength: 500
    },
    title: {
        type: String,
        default: 'Reminder'
    },
    scheduled_at: {
        type: Date,
        required: true
    },
    // Total number of times the TTS fires (1 = fire once, 3 = fire 3 times)
    repeat_count: {
        type: Number,
        required: true,
        min: 1,
        max: 20,
        default: 1
    },
    // Minutes between each repeat fire
    repeat_interval_min: {
        type: Number,
        required: true,
        min: 1,
        default: 15
    },
    is_daily: {
        type: Boolean,
        default: false
    },
    times_per_day: {
        type: Number,
        default: 1,
        min: 1,
        max: 10
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'cancelled'],
        default: 'pending'
    },
    fires_sent: {
        type: Number,
        default: 0
    },
    related_area_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SuggestedArea',
        default: null
    },
    is_urgent: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', reminder_schema);
