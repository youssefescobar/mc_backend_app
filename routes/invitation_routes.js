const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const { send_invitation_schema, group_id_param_schema, invitation_id_param_schema } = require('../middleware/schemas');
const {
    send_invitation,
    accept_invitation,
    decline_invitation,
    get_my_invitations
} = require('../controllers/invitation_controller');

// All routes require authentication
router.use(protect);

// Send invitation to a group (Moderator)
router.post('/groups/:group_id/invite', validate(group_id_param_schema, 'params'), validate(send_invitation_schema), send_invitation);

// Get my pending invitations
router.get('/invitations', get_my_invitations);

// Accept invitation
router.post('/invitations/:id/accept', validate(invitation_id_param_schema, 'params'), accept_invitation);

// Decline invitation
router.post('/invitations/:id/decline', validate(invitation_id_param_schema, 'params'), decline_invitation);

module.exports = router;
