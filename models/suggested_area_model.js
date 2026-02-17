const mongoose = require('mongoose');

const suggested_area_schema = new mongoose.Schema({
    group_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

suggested_area_schema.index({ group_id: 1, active: 1 });

module.exports = mongoose.model('SuggestedArea', suggested_area_schema);
