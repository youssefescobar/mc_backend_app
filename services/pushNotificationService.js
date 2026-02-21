const admin = require('../config/firebase');

/**
 * Send a multicast notification to multiple devices using Firebase Cloud Messaging (FCM).
 * This bypasses Expo's Push API and sends directly to the device's native token.
 * This is preferred for "Urgent" background notifications on Android.
 */
async function sendPushNotification(tokens, title, body, data = {}, isUrgent = false) {
    // Determine if we should use Data-Only (Silent) payload.
    // We ONLY want Data-Only for "Urgent TTS" messages so the app can control the "Sound -> TTS -> Sound" sequence.
    // For other urgent messages (Text, Voice Note) or normal messages, we want standard system notifications.
    const isUrgentTTS = isUrgent && data.messageType === 'tts';
    const isIncomingCall = data.type === 'incoming_call';

    // Construct the message payload (Base)
    const message = {
        tokens: tokens,
        data: {
            ...data,
            type: isIncomingCall ? 'incoming_call' : (isUrgent ? 'urgent' : 'normal'),
            title: title,
            body: body,
        },
        android: {
            priority: (isUrgent || isIncomingCall) ? 'high' : 'normal',
        },
        // We can add APNS (iOS) config here if needed later
    };

    if (isUrgentTTS || isIncomingCall) {
        // Data-Only: app handles presentation itself.
        // - Urgent TTS → app plays sound + TTS via BackgroundNotificationTask
        // - Incoming Call → app shows Notifee fullScreenIntent via BackgroundNotificationTask
    } else {
        // Standard Notification for everything else (Urgent Text, Urgent Voice, Normal messages, Incoming Calls)
        message.notification = {
            title: title,
            body: body,
        };

        message.android.notification = {
            channelId: isIncomingCall ? 'incoming_call' : (isUrgent ? 'urgent' : 'default'),
            // sound: isUrgent ? 'urgent.wav' : 'default', // Let channel handle sound for default
            sound: isUrgent ? 'urgent.wav' : undefined,
            priority: 'max', // Force heads-up for all notifications
            visibility: 'public',
        };

        // Note: FCM doesn't support action buttons in the notification payload directly
        // Action buttons need to be handled on the client side using Expo Notifications

        console.log('Sending Standard Notification:', JSON.stringify(message, null, 2));
    }

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
