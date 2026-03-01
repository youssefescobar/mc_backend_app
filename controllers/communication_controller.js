const CommunicationSession = require('../models/communication_session_model');
const Group = require('../models/group_model');
const { logger } = require('../config/logger');

// Start a new communication session
exports.start_session = async (req, res) => {
    try {
        const { group_id, type } = req.body;

        if (!['voice_call', 'video_call', 'walkie_talkie'].includes(type)) {
            return res.status(400).json({ message: "Invalid session type" });
        }

        // Verify group membership
        const group = await Group.findOne({
            _id: group_id,
            $or: [
                { pilgrim_ids: req.user.id },
                { moderator_ids: req.user.id }
            ]
        });

        if (!group) {
            return res.status(403).json({ message: "Not authorized to start session in this group" });
        }

        const session = await CommunicationSession.create({
            group_id,
            initiator_id: req.user.id,
            initiator_model: 'User',
            type,
            participants: [{
                user_id: req.user.id,
                user_model: 'User'
            }]
        });

        logger.info(`Communication session started: ${session._id} by ${req.user.id}`);

        res.status(201).json({
            success: true,
            message: "Session started",
            session_id: session._id,
            data: session
        });

    } catch (error) {
        logger.error(`Start session error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Join an active session
exports.join_session = async (req, res) => {
    try {
        const { session_id } = req.body;

        const session = await CommunicationSession.findOneAndUpdate(
            { _id: session_id, status: 'active' },
            {
                $addToSet: {
                    participants: {
                        user_id: req.user.id,
                        user_model: 'User'
                    }
                }
            },
            { new: true }
        );

        if (!session) {
            return res.status(404).json({ message: "Active session not found" });
        }

        res.json({
            success: true,
            message: "Joined session",
            session
        });

    } catch (error) {
        logger.error(`Join session error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// End a session (Initiator or Admin/Moderator only)
exports.end_session = async (req, res) => {
    try {
        const { session_id } = req.body;

        const session = await CommunicationSession.findById(session_id);
        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        // Only initiator or moderator can end (simplified check)
        // Ideally checking if user is a moderator of the group would be better security
        if (session.initiator_id.toString() !== req.user.id && req.user.user_type === 'pilgrim') {
            return res.status(403).json({ message: "Not authorized to end this session" });
        }

        session.status = 'ended';
        session.ended_at = Date.now();
        await session.save();

        logger.info(`Session ended: ${session_id} by ${req.user.id}`);

        res.json({ message: "Session ended" });

    } catch (error) {
        logger.error(`End session error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Get active sessions for a group
exports.get_active_sessions = async (req, res) => {
    try {
        const { group_id } = req.params;

        const sessions = await CommunicationSession.find({
            group_id,
            status: 'active'
        }).populate('initiator_id', 'full_name');

        res.json({
            success: true,
            data: sessions
        });
    } catch (error) {
        logger.error(`Get active sessions error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};
