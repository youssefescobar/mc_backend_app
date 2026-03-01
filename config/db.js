const mongoose = require('mongoose');
const { logger } = require('./logger');

// Connection configuration
mongoose.set('strictQuery', false);

const connectionOptions = {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 5000,
    family: 4 // Use IPv4
};

let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY_BASE = 2000; // 2 seconds base

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, connectionOptions);
        logger.info(`MongoDB Connected: ${conn.connection.host}`);
        retryCount = 0; // Reset on successful connection
    } catch (err) {
        logger.error(`MongoDB connection error: ${err.message}`);
        
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount - 1); // Exponential backoff
            logger.warn(`Retrying connection in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`);
            setTimeout(connectDB, delay);
        } else {
            logger.error('Max connection retries reached. Exiting...');
            process.exit(1);
        }
    }
};

// Event listeners
mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
});

mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
});

// Graceful disconnect
const disconnectDB = async () => {
    try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed gracefully');
    } catch (err) {
        logger.error(`Error closing MongoDB connection: ${err.message}`);
    }
};

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;