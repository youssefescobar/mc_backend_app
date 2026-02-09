const express = require('express');
const router = express.Router();
const message_ctrl = require('../controllers/message_controller');
const { protect } = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

// Protected routes
router.use(protect);

// Send message (Handles 'file' field for voice/image)
router.post('/', upload.single('file'), message_ctrl.send_message);

// Send individual message (Handles 'file' field for voice/image)
router.post('/individual', upload.single('file'), message_ctrl.send_individual_message);

// Get messages for a group
router.get('/group/:group_id', message_ctrl.get_group_messages);

// Get unread message count for a group
router.get('/group/:group_id/unread', message_ctrl.get_unread_count);

// Mark all messages in a group as read
router.post('/group/:group_id/mark-read', message_ctrl.mark_read);

// Delete a message
router.delete('/:message_id', message_ctrl.delete_message);

module.exports = router;
