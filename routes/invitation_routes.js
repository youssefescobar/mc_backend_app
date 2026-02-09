const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const { send_invitation_schema } = require('../middleware/schemas');
const {
    send_invitation,
    accept_invitation,
    decline_invitation,
    get_my_invitations
} = require('../controllers/invitation_controller');

// All routes require authentication
router.use(protect);

// Send invitation to a group (Moderator)
router.post('/groups/:group_id/invite', validate(send_invitation_schema), send_invitation);

// Get my pending invitations
router.get('/invitations', get_my_invitations);

// Accept invitation
router.post('/invitations/:id/accept', accept_invitation);

// Decline invitation
router.post('/invitations/:id/decline', decline_invitation);

module.exports = router;
