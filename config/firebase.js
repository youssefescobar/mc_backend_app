const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Path to service account key
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

// Check if file exists before initializing
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('Firebase Admin Initialized');
} else {
    console.warn('WARNING: serviceAccountKey.json not found in config/. Notifications will not work.');
}

module.exports = admin;
