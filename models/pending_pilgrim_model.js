const mongoose = require('mongoose');

const pending_pilgrim_schema = new mongoose.Schema({
    email: { type: String, required: true },
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verification_token: { type: String, required: true },
    expires_at: { type: Date, required: true },
    created_at: { type: Date, default: Date.now }
});

// Auto-delete after expiration (TTL index)
pending_pilgrim_schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingPilgrim', pending_pilgrim_schema);
