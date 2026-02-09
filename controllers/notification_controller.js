const Notification = require('../models/notification_model');

// Get notifications for current user
const get_notifications = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { limit = 20, skip = 0 } = req.query;

        const notifications = await Notification.find({ user_id })
            .sort({ created_at: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit));

        const unread_count = await Notification.countDocuments({ user_id, read: false });
        const total = await Notification.countDocuments({ user_id });

        res.json({
            success: true,
            notifications,
            unread_count,
            total
        });
    } catch (error) {
        console.error('Get notifications error:', error);
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
        console.error('Mark as read error:', error);
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
        console.error('Mark all read error:', error);
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
        console.error('Delete notification error:', error);
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
        console.error('Clear read notifications error:', error);
        res.status(500).json({ success: false, message: 'Failed to clear notifications' });
    }
};

module.exports = {
    get_notifications,
    mark_as_read,
    mark_all_read,
    delete_notification,
    delete_read_notifications
};
