const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema({
    caller_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'caller_model'
    },
    caller_model: {
        type: String,
        required: true,
        enum: ['User']
    },
    receiver_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'receiver_model'
    },
    receiver_model: {
        type: String,
        required: true,
        enum: ['User']
    },
    call_type: {
        type: String,
        required: true,
        enum: ['internet', 'phone'],
        default: 'internet'
    },
    status: {
        type: String,
        required: true,
        enum: ['ringing', 'in-progress', 'completed', 'missed', 'declined', 'unreachable'],
        default: 'ringing'
    },
    duration: {
        type: Number, // Duration in seconds
        default: 0
    },
    started_at: {
        type: Date,
        default: null
    },
    ended_at: {
        type: Date,
        default: null
    },
    is_read: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true // Adds createdAt and updatedAt
});

// Index for faster queries
callHistorySchema.index({ caller_id: 1, createdAt: -1 });
callHistorySchema.index({ receiver_id: 1, createdAt: -1 });

module.exports = mongoose.model('CallHistory', callHistorySchema);
