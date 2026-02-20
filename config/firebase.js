const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
    // Prefer local file if it exists (for local development)
    const serviceAccount = require(serviceAccountPath);
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info('Firebase Admin Initialized successfully from file');
    } catch (error) {
        logger.error(`Error initializing Firebase Admin: ${error.message}`);
    }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Fallback to environment variable (for Railway)
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info('Firebase Admin Initialized successfully from ENV');
    } catch (error) {
        logger.error(`Error initializing Firebase from ENV: ${error.message}`);
    }
} else {
    logger.warn('WARNING: FIREBASE_SERVICE_ACCOUNT env var not set and serviceAccountKey.json not found in config/. Notifications will not work.');
}

module.exports = admin;
