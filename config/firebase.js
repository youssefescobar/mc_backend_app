const admin = require('firebase-admin');
const { logger } = require('./logger');

let isFirebaseInitialized = false;

// Validate required environment variables
const validateCredentials = () => {
    const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        logger.warn(
            `Firebase Admin NOT initialized. Missing environment variables: ${missing.join(', ')}. ` +
            'Push notifications will not work.'
        );
        return false;
    }
    return true;
};

// Initialize Firebase Admin
if (validateCredentials()) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Unescape newlines in private key (Cloud Run / CI systems escape \n as \\n)
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
        isFirebaseInitialized = true;
        logger.info('✓ Firebase Admin initialized successfully');
    } catch (error) {
        logger.error(`✗ Firebase Admin initialization failed: ${error.message}`);
        logger.error('Push notifications will not work. Check your Firebase credentials.');
    }
}

// Helper to check initialization status
const isInitialized = () => isFirebaseInitialized;

// Get Firebase Messaging with safety check
const getMessaging = () => {
    if (!isFirebaseInitialized) {
        throw new Error('Firebase Admin is not initialized. Cannot send push notifications.');
    }
    return admin.messaging();
};

// Get Firebase Auth with safety check
const getAuth = () => {
    if (!isFirebaseInitialized) {
        throw new Error('Firebase Admin is not initialized. Cannot use Firebase Auth.');
    }
    return admin.auth();
};

module.exports = {
    admin,
    isInitialized,
    getMessaging,
    getAuth,
};
