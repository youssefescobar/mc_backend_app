const express = require('express');
const router = express.Router();
const auth_ctrl = require('../controllers/auth_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const { register_schema, login_schema, update_profile_schema, verify_email_schema, resend_verification_schema } = require('../middleware/schemas');
const { authLimiter, searchLimiter } = require('../middleware/rate_limit');

// Public routes with rate limiting
router.post('/register', authLimiter, validate(register_schema), auth_ctrl.register_user);
router.post('/register-invited-pilgrim', authLimiter, auth_ctrl.register_invited_pilgrim); // Public, token verifies auth
router.post('/verify-email', authLimiter, validate(verify_email_schema), auth_ctrl.verify_email);

router.post('/resend-verification', authLimiter, validate(resend_verification_schema), auth_ctrl.resend_verification);
router.post('/login', authLimiter, validate(login_schema), auth_ctrl.login_user);

const upload = require('../middleware/upload_middleware');

// Protected routes
router.use(protect);
router.get('/me', auth_ctrl.get_profile);
router.put('/update-profile', upload.single('profile_picture'), validate(update_profile_schema), auth_ctrl.update_profile);
router.put('/location', auth_ctrl.update_location);

// Moderator/Admin routes
router.post('/register-pilgrim', authorize('moderator', 'admin'), validate(require('../middleware/schemas').register_pilgrim_schema), auth_ctrl.register_pilgrim);
router.get('/search-pilgrims', authorize('moderator', 'admin'), searchLimiter, auth_ctrl.search_pilgrims);
router.get('/pilgrims/:pilgrim_id', authorize('moderator', 'admin'), auth_ctrl.get_pilgrim_by_id);

module.exports = router;
