const express = require('express');
const router = express.Router();
const group_controller = require('../controllers/group_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const { generalLimiter } = require('../middleware/rate_limit');
const validate = require('../middleware/validation_middleware');
const {
    create_group_schema,
    update_group_schema,
    join_group_schema,
    group_id_param_schema,
    user_id_param_schema,
    area_id_param_schema,
    add_pilgrim_schema,
    send_alert_schema,
    send_individual_alert_schema
} = require('../middleware/schemas');

// All routes here require login
router.use(protect);
// Apply general rate limiter for protected group endpoints
router.use(generalLimiter);

const moderatorAuth = authorize('moderator', 'admin');

// Only moderators can manage groups
router.post('/create', moderatorAuth, validate(create_group_schema), group_controller.create_group);
router.get('/dashboard', moderatorAuth, group_controller.get_my_groups);
// Band assignment routes removed
router.post('/send-alert', moderatorAuth, validate(send_alert_schema), group_controller.send_group_alert);
router.post('/send-individual-alert', moderatorAuth, validate(send_individual_alert_schema), group_controller.send_individual_alert);
router.post('/:group_id/add-pilgrim', moderatorAuth, validate(group_id_param_schema, 'params'), validate(add_pilgrim_schema), group_controller.add_pilgrim_to_group);
router.post('/:group_id/remove-pilgrim', moderatorAuth, validate(group_id_param_schema, 'params'), validate(add_pilgrim_schema), group_controller.remove_pilgrim_from_group);
// Available bands route removed
router.get('/:group_id', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.get_single_group);
router.get('/:group_id/resource-options', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.get_group_resource_options);
router.put('/:group_id', moderatorAuth, validate(group_id_param_schema, 'params'), validate(update_group_schema), group_controller.update_group_details);
router.delete('/:group_id', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.delete_group);
router.get('/:group_id/qr', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.generate_group_qr);
router.post('/join', validate(join_group_schema), group_controller.join_group);
router.delete('/:group_id/moderators/:user_id', moderatorAuth, validate(group_id_param_schema, 'params'), validate(user_id_param_schema, 'params'), group_controller.remove_moderator);
router.post('/:group_id/leave', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.leave_group);

// Suggested Areas
router.post('/:group_id/suggested-areas', moderatorAuth, validate(group_id_param_schema, 'params'), group_controller.add_suggested_area);
router.get('/:group_id/suggested-areas', validate(group_id_param_schema, 'params'), group_controller.get_suggested_areas);
router.put('/:group_id/suggested-areas/:area_id', moderatorAuth, validate(group_id_param_schema, 'params'), validate(area_id_param_schema, 'params'), group_controller.update_suggested_area);
router.delete('/:group_id/suggested-areas/:area_id', moderatorAuth, validate(area_id_param_schema, 'params'), group_controller.delete_suggested_area);

module.exports = router;