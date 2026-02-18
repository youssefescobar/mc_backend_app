const Notification = require('../models/notification_model');
const { logger } = require('../config/logger');

// Get notifications for current user
const get_notifications = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { limit = 20, skip = 0 } = req.query;

        const [notifications, unread_count, total] = await Promise.all([
            Notification.find({ user_id })
                .sort({ created_at: -1 })
                .skip(parseInt(skip))
                .limit(parseInt(limit)),
            Notification.countDocuments({ user_id, read: false }),
            Notification.countDocuments({ user_id })
        ]);

        res.json({
            success: true,
            notifications,
            unread_count,
            total
        });
    } catch (error) {
        logger.error(`Get notifications error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to get notifications' });
    }
};

// Mark single notification as read
const mark_as_read = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const notification = await Notification.findOneAndUpdate(
            { _id: id, user_id },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({
            success: true,
            notification
        });
    } catch (error) {
        logger.error(`Mark as read error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
    }
};

// Mark all notifications as read
const mark_all_read = async (req, res) => {
    try {
        const user_id = req.user.id;

        await Notification.updateMany(
            { user_id, read: false },
            { read: true }
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        logger.error(`Mark all read error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
    }
};

// Delete a single notification
const delete_notification = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const deleted = await Notification.findOneAndDelete({ _id: id, user_id });
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        logger.error(`Delete notification error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
};

// Delete all read notifications
const delete_read_notifications = async (req, res) => {
    try {
        const user_id = req.user.id;
        await Notification.deleteMany({ user_id, read: true });
        res.json({ success: true, message: 'Read notifications cleared' });
    } catch (error) {
        logger.error(`Clear read notifications error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to clear notifications' });
    }
};

// Get unread notification count
const get_unread_count = async (req, res) => {
    try {
        const user_id = req.user.id;
        const unread_count = await Notification.countDocuments({ user_id, read: false });
        res.json({ success: true, unread_count });
    } catch (error) {
        logger.error(`Get unread count error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to get unread count' });
    }
};

module.exports = {
    get_notifications,
    mark_as_read,
    mark_all_read,
    delete_notification,
    delete_read_notifications,
    get_unread_count
};
