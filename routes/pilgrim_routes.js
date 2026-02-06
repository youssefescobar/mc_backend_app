const express = require('express');
const router = express.Router();
const pilgrim_controller = require('../controllers/pilgrim_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const { generalLimiter } = require('../middleware/rate_limit');

// All routes require login as pilgrim
router.use(protect);
router.use(generalLimiter);

// Pilgrim routes
router.get('/profile', authorize('pilgrim'), pilgrim_controller.get_profile);
router.get('/my-group', authorize('pilgrim'), pilgrim_controller.get_my_group);
router.put('/location', authorize('pilgrim'), pilgrim_controller.update_location);
router.post('/sos', authorize('pilgrim'), pilgrim_controller.trigger_sos);

module.exports = router;
