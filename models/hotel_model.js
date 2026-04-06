const mongoose = require('mongoose');

const hotel_room_schema = new mongoose.Schema({
    room_number: { type: String, required: true, trim: true },
    floor: { type: String, trim: true, default: null },
    capacity: { type: Number, min: 1, default: 1 },
    active: { type: Boolean, default: true }
}, { _id: true });

const hotel_schema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    active: { type: Boolean, default: true },
    rooms: { type: [hotel_room_schema], default: [] },
    created_at: { type: Date, default: Date.now }
});

hotel_schema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Hotel', hotel_schema);
