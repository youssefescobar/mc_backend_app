const express = require('express');
const router = express.Router();
const group_controller = require('../controllers/group_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const { generalLimiter } = require('../middleware/rate_limit');
const validate = require('../middleware/validation_middleware');
const { create_group_schema, add_pilgrim_schema, send_alert_schema } = require('../middleware/schemas');

// All routes here require login
router.use(protect);
// Apply general rate limiter for protected group endpoints
router.use(generalLimiter);

// Only moderators can manage groups
router.post('/create', authorize('moderator', 'admin'), validate(create_group_schema), group_controller.create_group);
router.get('/dashboard', authorize('moderator', 'admin'), group_controller.get_my_groups);
// Band assignment routes removed
router.post('/send-alert', authorize('moderator', 'admin'), validate(send_alert_schema), group_controller.send_group_alert);
router.post('/send-individual-alert', authorize('moderator', 'admin'), validate(require('../middleware/schemas').send_individual_alert_schema), group_controller.send_individual_alert);
router.post('/:group_id/add-pilgrim', authorize('moderator', 'admin'), validate(add_pilgrim_schema), group_controller.add_pilgrim_to_group);
router.post('/:group_id/remove-pilgrim', authorize('moderator', 'admin'), validate(add_pilgrim_schema), group_controller.remove_pilgrim_from_group);
// Available bands route removed
router.get('/:group_id', authorize('moderator', 'admin'), group_controller.get_single_group);
router.put('/:group_id', authorize('moderator', 'admin'), group_controller.update_group_details);
router.delete('/:group_id', authorize('moderator', 'admin'), group_controller.delete_group);
router.get('/:group_id/qr', authorize('moderator', 'admin'), group_controller.generate_group_qr);
router.post('/join', group_controller.join_group);
// router.delete('/:group_id/moderators/:user_id', authorize('moderator', 'admin'), group_controller.remove_moderator);
router.post('/:group_id/leave', authorize('moderator', 'admin'), group_controller.leave_group);

// Suggested Areas
router.post('/:group_id/suggested-areas', authorize('moderator', 'admin'), group_controller.add_suggested_area);
router.get('/:group_id/suggested-areas', group_controller.get_suggested_areas);
router.delete('/:group_id/suggested-areas/:area_id', authorize('moderator', 'admin'), group_controller.delete_suggested_area);

module.exports = router;