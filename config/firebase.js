const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
    // Local development — use the key file directly
    const serviceAccount = require(serviceAccountPath);
    try {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        logger.info('Firebase Admin initialized from serviceAccountKey.json');
    } catch (error) {
        logger.error(`Error initializing Firebase Admin: ${error.message}`);
    }

} else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
) {
    // Production — use individual environment variables (no JSON blob needed)
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Cloud Run / most CI systems escape \n as \\n in env vars — unescape it
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
        logger.info('Firebase Admin initialized from environment variables');
    } catch (error) {
        logger.error(`Error initializing Firebase Admin from ENV: ${error.message}`);
    }

} else {
    logger.warn(
        'Firebase Admin NOT initialized. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.'
    );
}

module.exports = admin;
