const express = require('express');
const router = express.Router();
const { sendPushNotification } = require('../services/pushNotificationService');

// Test route to send notification
router.post('/send', async (req, res) => {
    const { tokens, title, body, data, isUrgent } = req.body;

    if (!tokens || !Array.isArray(tokens)) {
        return res.status(400).json({ error: 'tokens array is required' });
    }

    try {
        const result = await sendPushNotification(tokens, title, body, data, isUrgent);
        res.json({ success: true, result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

module.exports = router;
