const express = require('express');
const router = express.Router();
const message_ctrl = require('../controllers/message_controller');
const { protect } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const { send_message_schema, group_id_param_schema, message_id_param_schema } = require('../middleware/schemas');
const upload = require('../middleware/upload_middleware');
const { validateUploadedFile } = require('../middleware/upload_middleware');

// Protected routes
router.use(protect);

// Send message (Handles 'file' field for voice/image)
router.post('/', upload.single('file'), validateUploadedFile, validate(send_message_schema), message_ctrl.send_message);

// Send individual message (Handles 'file' field for voice/image)
router.post('/individual', upload.single('file'), validateUploadedFile, validate(send_message_schema), message_ctrl.send_individual_message);

// Get messages for a group
router.get('/group/:group_id', validate(group_id_param_schema, 'params'), message_ctrl.get_group_messages);

// Get unread message count for a group
router.get('/group/:group_id/unread', validate(group_id_param_schema, 'params'), message_ctrl.get_unread_count);

// Mark all messages in a group as read
router.post('/group/:group_id/mark-read', validate(group_id_param_schema, 'params'), message_ctrl.mark_read);

// Delete a message
router.delete('/:message_id', validate(message_id_param_schema, 'params'), message_ctrl.delete_message);

module.exports = router;
