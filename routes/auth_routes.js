const express = require('express');
const router = express.Router();
const auth_ctrl = require('../controllers/auth_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const {
    register_schema,
    login_schema,
    update_profile_schema,
    add_email_schema,
    verify_pilgrim_email_schema,
    request_moderator_schema
} = require('../middleware/schemas');
const { authLimiter, searchLimiter } = require('../middleware/rate_limit');

// Public routes with rate limiting
router.post('/register', authLimiter, validate(register_schema), auth_ctrl.register_user);
router.post('/register-invited-pilgrim', authLimiter, auth_ctrl.register_invited_pilgrim); // Public, token verifies auth
router.post('/login', authLimiter, validate(login_schema), auth_ctrl.login_user);

const upload = require('../middleware/upload_middleware');

// Protected routes
router.use(protect);
router.get('/me', auth_ctrl.get_profile);
router.put('/update-profile', upload.single('profile_picture'), validate(update_profile_schema), auth_ctrl.update_profile);
router.put('/location', auth_ctrl.update_location);

// Email management for pilgrims
router.post('/add-email', validate(add_email_schema), auth_ctrl.add_email);
router.post('/send-email-verification', auth_ctrl.send_email_verification);
router.post('/verify-email', validate(verify_pilgrim_email_schema), auth_ctrl.verify_pilgrim_email);

// Moderator request
router.post('/request-moderator', validate(request_moderator_schema), auth_ctrl.request_moderator);

// Admin: review moderator requests
router.get('/moderator-requests', authorize('admin'), auth_ctrl.get_pending_moderator_requests);
router.put('/moderator-requests/:request_id/approve', authorize('admin'), auth_ctrl.approve_moderator_request);
router.put('/moderator-requests/:request_id/reject', authorize('admin'), auth_ctrl.reject_moderator_request);

// Moderator/Admin routes
router.post('/register-pilgrim', authorize('moderator', 'admin'), validate(require('../middleware/schemas').register_pilgrim_schema), auth_ctrl.register_pilgrim);
router.get('/search-pilgrims', authorize('moderator', 'admin'), searchLimiter, auth_ctrl.search_pilgrims);
router.get('/pilgrims/:pilgrim_id', authorize('moderator', 'admin'), auth_ctrl.get_pilgrim_by_id);

module.exports = router;
