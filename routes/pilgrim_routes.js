const express = require('express');
const router = express.Router();
const profile_controller = require('../controllers/profile_controller');
const { protect, authorize } = require('../middleware/auth_middleware');
const { generalLimiter } = require('../middleware/rate_limit');

// All routes require login as pilgrim
router.use(protect);
router.use(generalLimiter);

// Pilgrim routes (now use profile_controller)
router.get('/profile', authorize('pilgrim'), profile_controller.get_profile);
router.get('/my-group', authorize('pilgrim'), profile_controller.get_my_group);
router.put('/location', authorize('pilgrim'), profile_controller.update_location);
router.post('/sos', authorize('pilgrim'), profile_controller.trigger_sos);

module.exports = router;
