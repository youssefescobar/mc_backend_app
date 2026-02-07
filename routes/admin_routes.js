const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin_controller');
const { verifyToken, verifyAdmin } = require('../middleware/auth_middleware');

// Apply middleware to all admin routes
router.use(verifyToken);

// Moderator Request Routes
// Users request to be moderators (Any authenticated user can request, but usually 'pilgrim')
router.post('/request-moderator', adminController.submit_moderator_request);

module.exports = router;
