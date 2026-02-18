const express = require('express');
const router = express.Router();
const { sendPushNotification } = require('../services/pushNotificationService');
const { protect, authorize } = require('../middleware/auth_middleware');
const { logger } = require('../config/logger');

// Test route to send notification (Admin Only)
router.post('/send', protect, authorize('admin'), async (req, res) => {
    const { tokens, title, body, data, isUrgent } = req.body;

    if (!tokens || !Array.isArray(tokens)) {
        return res.status(400).json({ error: 'tokens array is required' });
    }

    try {
        const result = await sendPushNotification(tokens, title, body, data, isUrgent);
        logger.info(`Push notification sent successfully locally`);
        res.json({ success: true, result });
    } catch (error) {
        logger.error(`Failed to send push notification: ${error.message}`);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

module.exports = router;
