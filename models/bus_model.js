const mongoose = require('mongoose');

const bus_schema = new mongoose.Schema({
    bus_number: { type: String, required: true, trim: true },
    driver_name: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    departure_time: { type: Date, required: true },
    plate_number: { type: String, trim: true, default: null },
    seats_count: { type: Number, min: 1, default: 50 },
    notes: { type: String, trim: true, default: null },
    active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now }
});

bus_schema.index({ bus_number: 1 }, { unique: true });

module.exports = mongoose.model('Bus', bus_schema);
