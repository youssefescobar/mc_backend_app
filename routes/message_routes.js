const express = require('express');
const router = express.Router();
const message_ctrl = require('../controllers/message_controller');
const { protect } = require('../middleware/auth_middleware');
const upload = require('../middleware/upload_middleware');

// Protected routes
router.use(protect);

// Send message (Handles 'file' field for voice/image)
router.post('/', upload.single('file'), message_ctrl.send_message);

// Get messages for a group
router.get('/group/:group_id', message_ctrl.get_group_messages);

module.exports = router;
