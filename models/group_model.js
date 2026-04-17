const mongoose = require('mongoose');

const group_schema = new mongoose.Schema({
    group_name: { type: String, required: true },
    group_code: { type: String, unique: true, required: true }, // For joining via code
    check_in_date: { type: Date },
    check_out_date: { type: Date },
    moderator_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Multiple moderators allowed
    pilgrim_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_hotel_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' }],
    assigned_bus_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bus' }],
    allow_pilgrim_navigation: { type: Boolean, default: false } // Allow pilgrims to navigate to moderator location
}, { timestamps: true });

module.exports = mongoose.model('Group', group_schema);