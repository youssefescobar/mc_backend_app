const mongoose = require('mongoose');

const reminder_schema = new mongoose.Schema({
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    group_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    // 'pilgrim' = one specific pilgrim, 'group' = everyone in the group
    target_type: {
        type: String,
        enum: ['pilgrim', 'group'],
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
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'cancelled'],
        default: 'pending'
    },
    fires_sent: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', reminder_schema);
