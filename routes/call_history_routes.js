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

// Check if a call is still active (no auth — used from killed-state accept flow)
router.get('/check-active', call_history_ctrl.check_call_active);

// Decline a call from background notification (no auth — called from device when app is killed)
router.post('/decline', (req, res, next) => { console.log('>>> /decline route HIT, bypassing auth'); next(); }, call_history_ctrl.decline_call);

// Answer a call from background/killed state (no auth — REST fallback when socket isn't connected)
router.post('/answer', call_history_ctrl.answer_call);

module.exports = router;
