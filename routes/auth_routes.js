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
    request_moderator_schema,
    update_language_schema,
    register_pilgrim_schema
} = require('../middleware/schemas');
const { authLimiter, loginLimiter, registerLimiter, searchLimiter } = require('../middleware/rate_limit');
const upload = require('../middleware/upload_middleware');

// ==========================================
// Public Routes
// ==========================================
router.post('/register', registerLimiter, validate(register_schema), auth_ctrl.register_user);
router.post('/register-invited-pilgrim', registerLimiter, auth_ctrl.register_invited_pilgrim);
router.post('/login', loginLimiter, validate(login_schema), auth_ctrl.login_user);

// ==========================================
// Protected Routes (All Users)
// ==========================================
router.use(protect); // Apply protection to all routes below

// Auth & Profile
router.post('/logout', auth_ctrl.logout_user);
router.get('/me', auth_ctrl.get_profile);
router.put('/update-profile', validate(update_profile_schema), auth_ctrl.update_profile);
router.put('/update-language', validate(update_language_schema), auth_ctrl.update_language);
router.put('/location', auth_ctrl.update_location);
router.put('/fcm-token', auth_ctrl.update_fcm_token);

// Email Verification
router.post('/add-email', validate(add_email_schema), auth_ctrl.add_email);
router.post('/send-email-verification', auth_ctrl.send_email_verification);
router.post('/resend-verification', auth_ctrl.send_email_verification);
router.post('/verify-email', validate(verify_pilgrim_email_schema), auth_ctrl.verify_pilgrim_email);

// Moderator Request
router.post('/request-moderator', validate(request_moderator_schema), auth_ctrl.request_moderator);


// ==========================================
// Moderator & Admin Routes
// ==========================================
const modAuth = authorize('moderator', 'admin');

router.post('/register-pilgrim', modAuth, validate(register_pilgrim_schema), auth_ctrl.register_pilgrim);
router.get('/search-pilgrims', modAuth, searchLimiter, auth_ctrl.search_pilgrims);
router.get('/pilgrims/:pilgrim_id', modAuth, auth_ctrl.get_pilgrim_by_id);

module.exports = router;
