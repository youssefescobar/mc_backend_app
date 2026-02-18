const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

// Path to service account key
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

// Check if file exists before initializing
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);

    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info('Firebase Admin Initialized successfully');
    } catch (error) {
        logger.error(`Error initializing Firebase Admin: ${error.message}`);
    }
} else {
    logger.warn('WARNING: serviceAccountKey.json not found in config/. Notifications will not work.');
}

module.exports = admin;
