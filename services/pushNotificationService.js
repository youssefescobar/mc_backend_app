const { getMessaging, isInitialized } = require('../config/firebase');
const { logger } = require('../config/logger');

/**
 * Send a multicast notification to multiple devices using Firebase Cloud Messaging (FCM).
 * This bypasses Expo's Push API and sends directly to the device's native token.
 * This is preferred for "Urgent" background notifications on Android.
 */
async function sendPushNotification(tokens, title, body, data = {}, isUrgent = false) {
    // Check if Firebase is initialized
    if (!isInitialized()) {
        logger.error('Cannot send push notification: Firebase is not initialized');
        throw new Error('Firebase Admin is not initialized');
    }

    // Guard: never send a notification with empty title/body
    if (!title || !body) {
        logger.warn('[FCM] Skipping notification with empty title or body', { title, body });
        return null;
    }

    // Determine if we should use Data-Only (Silent) payload.
    // We ONLY want Data-Only for "Urgent TTS" messages so the app can control the "Sound -> TTS -> Sound" sequence.
    // For other urgent messages (Text, Voice Note) or normal messages, we want standard system notifications.
    const isUrgentTTS = isUrgent && data.messageType === 'tts';
    const isIncomingCall = data.type === 'incoming_call';

    // Construct the message payload (Base)
    // Preserve the caller-supplied 'type' (e.g. 'new_message') as 'notification_type'
    // so we can use it for deep-link navigation on the client side.
    const notificationType = data.type || 'general';
    const message = {
        tokens: tokens,
        data: {
            ...data,
            // 'type' controls how the Flutter client shows the notification (urgent/normal/incoming_call)
            type: isIncomingCall ? 'incoming_call' : (isUrgent ? 'urgent' : 'normal'),
            // 'notification_type' is the semantic type — what this notification is about
            notification_type: notificationType,
            title: title,
            body: body,
        },
        android: {
            priority: (isUrgent || isIncomingCall) ? 'high' : 'normal',
        },
        // We can add APNS (iOS) config here if needed later
    };

    if (isUrgentTTS) {
        // DATA-ONLY: app JS runtime handles the full presentation via BackgroundNotificationTask.
        // - Urgent TTS   → plays sound + TTS sequence
        logger.info('[FCM] Sending data-only urgent TTS (background task will handle UI)');
    } else if (isIncomingCall) {
        // ── INCOMING CALL: DATA-ONLY message ─────────────────────────────────
        // CRITICAL: Must be data-only (no 'notification' block) so that the
        // Flutter background handler ALWAYS fires — even when app is killed.
        // The Flutter side uses flutter_callkit_incoming to show a native
        // incoming-call screen (like WhatsApp / Messenger).
        // If we include a 'notification' block, Android shows its own
        // notification and the background handler may NOT run.
        logger.info('[FCM] Sending DATA-ONLY incoming call (flutter_callkit_incoming will show native call UI)');
    } else {
        // Standard Notification for everything else (messages, urgent text, etc.)
        message.notification = {
            title: title,
            body: body,
        };

        message.android.notification = {
            channelId: isUrgent ? 'mc_urgent_v2' : 'mc_default_v2',
            sound: isUrgent ? 'urgent_tts' : 'background_app',
            priority: 'max',
            visibility: 'public',
        };

        logger.debug('Sending Standard Notification:', JSON.stringify(message, null, 2));
    }

    try {
        const messaging = getMessaging();
        const response = await messaging.sendEachForMulticast(message);
        logger.info(`FCM Notification sent: ${response.successCount}/${tokens.length} succeeded`);

        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                    logger.error(`Failure sending to token ${tokens[idx]}: ${resp.error?.message}`);
                }
            });
            logger.warn(`Failed tokens count: ${failedTokens.length}`);
        }

        return response;
    } catch (error) {
        logger.error('Error sending FCM notification:', error);
        throw error;
    }
}

module.exports = {
    sendPushNotification,
};
