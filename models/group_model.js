const mongoose = require('mongoose');

const group_schema = new mongoose.Schema({
    group_name: { type: String, required: true },
    group_code: { type: String, unique: true, required: true }, // For joining via code
    moderator_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Multiple moderators allowed
    pilgrim_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pilgrim' }],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    available_band_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HardwareBand' }]
}, { timestamps: true });

module.exports = mongoose.model('Group', group_schema);