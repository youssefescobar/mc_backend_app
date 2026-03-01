const express = require('express');
const router = express.Router();
const communication_ctrl = require('../controllers/communication_controller');
const { protect } = require('../middleware/auth_middleware');
const validate = require('../middleware/validation_middleware');
const {
    start_session_schema,
    join_session_schema,
    end_session_schema
} = require('../middleware/schemas');

router.use(protect);

router.post('/start-session', validate(start_session_schema), communication_ctrl.start_session);
router.post('/join-session', validate(join_session_schema), communication_ctrl.join_session);
router.post('/end-session', validate(end_session_schema), communication_ctrl.end_session);
router.get('/sessions/:group_id', communication_ctrl.get_active_sessions);

module.exports = router;
