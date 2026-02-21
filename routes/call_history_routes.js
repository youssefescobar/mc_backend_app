const express = require('express');
const router = express.Router();
const call_history_ctrl = require('../controllers/call_history_controller');
const { protect } = require('../middleware/auth_middleware');

// Get call history for current user
router.get('/', protect, call_history_ctrl.get_call_history);

// Create call record (used internally by socket handlers)
router.post('/', protect, call_history_ctrl.create_call_record);

// Get unread missed call count
router.get('/unread-count', protect, call_history_ctrl.get_unread_count);

// Mark all missed calls as read
router.put('/mark-read', protect, call_history_ctrl.mark_read);

// Decline a call from background notification (no auth — called from device when app is killed)
router.post('/decline', call_history_ctrl.decline_call);

module.exports = router;
