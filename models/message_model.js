const mongoose = require('mongoose');

const message_schema = new mongoose.Schema({
    group_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    sender_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['text', 'voice', 'image'],
        default: 'text'
    },
    content: {
        type: String,
        required: function () { return this.type === 'text'; }
    },
    media_url: {
        type: String,
        required: function () { return this.type !== 'text'; }
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Message', message_schema);
