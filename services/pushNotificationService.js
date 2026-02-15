const admin = require('../config/firebase');

/**
 * Send a multicast notification to multiple devices using Firebase Cloud Messaging (FCM).
 * This bypasses Expo's Push API and sends directly to the device's native token.
 * This is preferred for "Urgent" background notifications on Android.
 */
async function sendPushNotification(tokens, title, body, data = {}, isUrgent = false) {
    // Construct the message payload
    const message = {
        tokens: tokens, // Array of FCM tokens
        notification: {
            title: title,
            body: body,
        },
        data: {
            ...data,
            type: isUrgent ? 'urgent' : 'normal',
        },
        android: {
            priority: isUrgent ? 'high' : 'normal',
            notification: {
                channelId: isUrgent ? 'urgent' : 'default',
                sound: isUrgent ? 'urgent' : 'default',
                priority: isUrgent ? 'max' : 'default',
                defaultSound: !isUrgent,
            },
        },
        // We can add APNS (iOS) config here if needed later
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log('FCM Notification sent:', response);

        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                    console.error(`Failure sending to token ${tokens[idx]}:`, resp.error);
                }
            });
            console.log('Failed tokens:', failedTokens);
        }

        return response;
    } catch (error) {
        console.error('Error sending FCM notification:', error);
        throw error;
    }
}

module.exports = {
    sendPushNotification,
};
