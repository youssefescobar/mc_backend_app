const express = require('express');
const router = express.Router();
const call_history_ctrl = require('../controllers/call_history_controller');
const { protect } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const { call_active_query_schema, answer_call_schema, decline_call_schema } = require('../middleware/schemas');

// Get call history for current user
router.get('/', protect, call_history_ctrl.get_call_history);

// Create call record (used internally by socket handlers)
router.post('/', protect, call_history_ctrl.create_call_record);

// Get unread missed call count
router.get('/unread-count', protect, call_history_ctrl.get_unread_count);

// Mark all missed calls as read
router.put('/mark-read', protect, call_history_ctrl.mark_read);

// Check if a call is still active (no auth — used from killed-state accept flow)
router.get('/check-active', validate(call_active_query_schema, 'query'), call_history_ctrl.check_call_active);

// Decline a call from background notification (no auth — called from device when app is killed)
router.post('/decline', validate(decline_call_schema), (req, res, next) => { console.log('>>> /decline route HIT, bypassing auth'); next(); }, call_history_ctrl.decline_call);

// Answer a call from background/killed state (no auth — REST fallback when socket isn't connected)
router.post('/answer', validate(answer_call_schema), call_history_ctrl.answer_call);

module.exports = router;
