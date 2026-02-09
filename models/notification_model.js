const mongoose = require('mongoose');

const notification_schema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: [
            'group_invitation',
            'invitation_accepted',
            'invitation_declined',
            'moderator_removed',
            'moderator_left',
            'moderator_request_approved',
            'moderator_request_rejected',
            'sos_alert'
        ],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    data: {
        invitation_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Invitation'
        },
        request_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ModeratorRequest'
        },
        group_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group'
        },
        group_name: String,
        inviter_name: String,
        pilgrim_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pilgrim'
        },
        pilgrim_name: String,
        pilgrim_phone: String,
        location: {
            lat: Number,
            lng: Number
        }
    },
    read: {
        type: Boolean,
        default: false
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient queries
notification_schema.index({ user_id: 1, read: 1, created_at: -1 });

module.exports = mongoose.model('Notification', notification_schema);
