const Group = require('../models/group_model');
const User = require('../models/user_model');
const Notification = require('../models/notification_model');

// Get pilgrim profile
exports.get_profile = async (req, res) => {
    try {
        // Find user by ID (since self-registered pilgrims are in User collection)
        const pilgrim = await User.findById(req.user.id).select('-password');
        if (!pilgrim) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(pilgrim);
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get pilgrim's assigned group
exports.get_my_group = async (req, res) => {
    try {
        // Find group that contains this pilgrim (User ID)
        const group = await Group.findOne({ pilgrims: req.user.id })
            .populate('created_by', 'full_name email phone_number current_latitude current_longitude')
            .populate('moderators', 'full_name email phone_number current_latitude current_longitude');

        if (!group) {
            return res.status(404).json({ message: 'You are not assigned to any group' });
        }

        res.json({
            group_name: group.group_name,
            group_id: group._id,
            created_by: group.created_by,
            moderators: group.moderators,
            pilgrim_count: group.pilgrims?.length || 0
        });
    } catch (error) {
        console.error('Get my group error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update pilgrim location
exports.update_location = async (req, res) => {
    try {
        const { latitude, longitude, battery_percent } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({ message: 'Latitude and longitude required' });
        }

        // Update User model directly
        const pilgrim = await User.findByIdAndUpdate(
            req.user.id,
            {
                current_latitude: latitude,
                current_longitude: longitude,
                last_location_update: new Date(),
                // User model doesn't explicitly have battery_percent in schema shown, 
                // but we can add it or ignore it if not in schema. 
                // Actually, let's try to save it if schema allows or it's flexible.
                // Looking at user_model.js, it DOES have location but NO battery_percent.
                // We'll proceed with location update.
            },
            { new: true }
        );

        if (!pilgrim) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'Location updated', last_update: pilgrim.last_location_update });
    } catch (error) {
        console.error('Update location error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Trigger SOS emergency alert
exports.trigger_sos = async (req, res) => {
    try {
        const pilgrim = await User.findById(req.user.id);
        if (!pilgrim) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Find the group this pilgrim belongs to
        const group = await Group.findOne({ pilgrims: req.user.id })
            .populate('moderators', '_id full_name');

        if (!group) {
            return res.status(404).json({ message: 'Not assigned to any group' });
        }

        // Create notifications for all moderators in the group
        const moderatorIds = [group.created_by, ...group.moderators.map(m => m._id)];

        const notifications = moderatorIds.map(modId => ({
            user: modId,
            type: 'sos_alert',
            title: '🚨 SOS EMERGENCY',
            message: `${pilgrim.full_name} has triggered an emergency SOS alert!`,
            data: {
                pilgrim_id: pilgrim._id,
                pilgrim_name: pilgrim.full_name,
                location: {
                    lat: pilgrim.current_latitude,
                    lng: pilgrim.current_longitude
                },
                group_id: group._id,
                group_name: group.group_name
            }
        }));

        await Notification.insertMany(notifications);

        res.json({
            message: 'SOS alert sent to moderators',
            notified_count: moderatorIds.length
        });
    } catch (error) {
        console.error('SOS trigger error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
