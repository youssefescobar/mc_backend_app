const mongoose = require('mongoose');
const { logger } = require('./logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        logger.info(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        logger.error(`Error: ${err.message}`);
        process.exit(1);
    }

    mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection error: ${err}`);
    });
};

module.exports = connectDB;