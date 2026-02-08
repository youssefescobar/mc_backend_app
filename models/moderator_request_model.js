const mongoose = require('mongoose');

const moderator_request_schema = new mongoose.Schema({
    pilgrim_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pilgrim',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    requested_at: {
        type: Date,
        default: Date.now
    },
    reviewed_at: {
        type: Date
    },
    reviewed_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: {
        type: String
    }
});

// Ensure only one pending request per pilgrim
moderator_request_schema.index({ pilgrim_id: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('ModeratorRequest', moderator_request_schema);
