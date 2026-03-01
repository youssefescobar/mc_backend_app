const express = require('express');
const router = express.Router();
const { sendPushNotification } = require('../services/pushNotificationService');
const { protect, authorize } = require('../middleware/auth_middleware');
const { logger } = require('../config/logger');
const { sendSuccess, sendError, sendServerError } = require('../utils/response_helpers');

// Test route to send notification (Admin Only)
router.post('/send', protect, authorize('admin'), async (req, res) => {
    const { tokens, title, body, data, isUrgent } = req.body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        return sendError(res, 400, 'Valid tokens array is required');
    }

    if (!title || !body) {
        return sendError(res, 400, 'Title and body are required');
    }

    try {
        const result = await sendPushNotification(tokens, title, body, data, isUrgent);
        logger.info(`Push notification sent to ${tokens.length} device(s)`);
        sendSuccess(res, 200, 'Push notification sent successfully', { result });
    } catch (error) {
        sendServerError(res, logger, 'Failed to send push notification', error);
    }
});

module.exports = router;
