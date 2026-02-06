const Message = require('../models/message_model');
const Group = require('../models/group_model');

// Send a message (Text, Voice, or Image)
exports.send_message = async (req, res) => {
    try {
        const { group_id, type, content } = req.body;
        const file = req.file;

        // Validation
        if (!group_id) {
            return res.status(400).json({ message: "Group ID is required" });
        }

        // Verify sender belongs to the group (as moderator or admin)
        // Note: Currently assuming only moderators/admins send broadcast messages
        // If pilgrims can reply, we'd check if they are in the group.

        let media_url = null;
        if (type !== 'text') {
            if (!file) {
                return res.status(400).json({ message: "Media file is required for voice/image messages" });
            }
            media_url = file.filename; // or full path depending on storage config
        }

        const message = await Message.create({
            group_id,
            sender_id: req.user.id,
            type: type || 'text',
            content,
            media_url
        });

        // Populate sender info for immediate frontend display
        await message.populate('sender_id', 'full_name profile_picture role');

        res.status(201).json({
            success: true,
            data: message
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ message: "Server error" });
    }
};

// Get messages for a group
exports.get_group_messages = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { limit = 50, before } = req.query; // Pagination using timestamp

        const query = { group_id };
        if (before) {
            query.created_at = { $lt: new Date(before) };
        }

        const messages = await Message.find(query)
            .sort({ created_at: -1 }) // Newest first
            .limit(parseInt(limit))
            .populate('sender_id', 'full_name profile_picture role');

        res.json({
            success: true,
            data: messages
        });

    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ message: "Server error" });
    }
};
