const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin_controller');
const { verifyToken, verifyAdmin } = require('../middleware/auth_middleware');

// Apply middleware to all admin routes
router.use(verifyToken);

// Moderator Request Routes
// Users request to be moderators (Any authenticated user can request, but usually 'pilgrim')
router.post('/request-moderator', adminController.submit_moderator_request);

// Admin Only Routes
router.use(verifyAdmin); // Enforce Admin role for following routes

router.get('/requests', adminController.get_pending_requests);
router.put('/requests/:request_id/approve', adminController.approve_moderator_request);
router.put('/requests/:request_id/reject', adminController.reject_moderator_request);

// Existing admin routes (if any needed to be moved here, but keeping standard routes separate for now)
router.get('/users', adminController.get_all_users);
router.get('/groups', adminController.get_all_groups);
router.get('/stats', adminController.get_system_stats);

module.exports = router;
