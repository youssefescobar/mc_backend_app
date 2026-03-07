const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth_middleware');
const {
    create_reminder,
    get_reminders,
    cancel_reminder,
    delete_reminder
} = require('../controllers/reminder_controller');

// All routes require authentication (moderator only by convention)
router.use(protect);

// GET    /api/reminders?group_id=X  – list reminders for a group
router.get('/', get_reminders);

// POST   /api/reminders             – create a new reminder
router.post('/', create_reminder);

// PATCH  /api/reminders/:id/cancel  – soft-cancel (status = cancelled, kept in DB)
router.patch('/:id/cancel', cancel_reminder);

// DELETE /api/reminders/:id         – hard-delete (permanently removed from DB)
router.delete('/:id', delete_reminder);

module.exports = router;
