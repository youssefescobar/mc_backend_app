const mongoose = require('mongoose');

const communication_session_schema = new mongoose.Schema({
    group_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    initiator_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'initiator_model'
    },
    initiator_model: {
        type: String,
        required: true,
        enum: ['User']
    },
    type: {
        type: String,
        enum: ['voice_call', 'video_call', 'walkie_talkie'],
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },
    participants: [{
        user_id: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'participants.user_model' },
        user_model: { type: String, required: true, enum: ['User'] },
        joined_at: { type: Date, default: Date.now }
    }],
    started_at: {
        type: Date,
        default: Date.now
    },
    ended_at: {
        type: Date
    }
});

module.exports = mongoose.model('CommunicationSession', communication_session_schema);
