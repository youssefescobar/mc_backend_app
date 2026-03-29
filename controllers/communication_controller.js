const CommunicationSession = require('../models/communication_session_model');
const Group = require('../models/group_model');
const mongoose = require('mongoose');
const { logger } = require('../config/logger');
const { sendSuccess, sendError, sendServerError } = require('../utils/response_helpers');

const toObjectId = (value) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

// Start a new communication session
exports.start_session = async (req, res) => {
    try {
        const { group_id, type } = req.body;
        const safe_group_id = toObjectId(group_id);
        const safe_user_id = toObjectId(req.user.id);

        if (!safe_group_id || !safe_user_id || !type) {
            return sendError(res, 400, 'Group ID and session type are required');
        }

        if (!['voice_call', 'video_call', 'walkie_talkie'].includes(type)) {
            return sendError(res, 400, 'Invalid session type. Must be voice_call, video_call, or walkie_talkie');
        }

        // Verify group membership
        const group = await Group.findOne({
            _id: safe_group_id,
            $or: [
                { pilgrim_ids: safe_user_id },
                { moderator_ids: safe_user_id }
            ]
        });

        if (!group) {
            return sendError(res, 403, 'Not authorized to start session in this group');
        }

        const session = await CommunicationSession.create({
            group_id: safe_group_id,
            initiator_id: safe_user_id,
            initiator_model: 'User',
            type,
            participants: [{
                user_id: safe_user_id,
                user_model: 'User'
            }]
        });

        logger.info(`Communication session started: ${session._id} by ${req.user.id}`);

        sendSuccess(res, 201, 'Session started successfully', {
            session_id: session._id,
            session
        });

    } catch (error) {
        sendServerError(res, logger, 'Start session error', error);
    }
};

// Join an active session
exports.join_session = async (req, res) => {
    try {
        const session_id = toObjectId(req.body.session_id);
        const safe_user_id = toObjectId(req.user.id);

        if (!session_id || !safe_user_id) {
            return sendError(res, 400, 'Session ID is required');
        }

        // Get the session and verify it exists and is active
        const existingSession = await CommunicationSession.findOne({
            _id: session_id,
            status: 'active'
        });

        if (!existingSession) {
            return sendError(res, 404, 'Active session not found');
        }

        // Verify user is member of the group
        const group = await Group.findOne({
            _id: existingSession.group_id,
            $or: [
                { pilgrim_ids: safe_user_id },
                { moderator_ids: safe_user_id }
            ]
        });

        if (!group) {
            return sendError(res, 403, 'Not authorized to join this session');
        }

        // Add user to participants
        const session = await CommunicationSession.findOneAndUpdate(
            { _id: session_id, status: 'active' },
            {
                $addToSet: {
                    participants: {
                        user_id: safe_user_id,
                        user_model: 'User'
                    }
                }
            },
            { new: true }
        );

        logger.info(`User ${req.user.id} joined session: ${session_id}`);

        sendSuccess(res, 200, 'Joined session successfully', { session });

    } catch (error) {
        sendServerError(res, logger, 'Join session error', error);
    }
};

// End a communication session
exports.end_session = async (req, res) => {
    try {
        const session_id = toObjectId(req.body.session_id);

        if (!session_id) {
            return sendError(res, 400, 'Session ID is required');
        }

        const session = await CommunicationSession.findById(session_id);
        if (!session) {
            return sendError(res, 404, 'Session not found');
        }

        if (session.status !== 'active') {
            return sendError(res, 400, 'Session is already ended');
        }

        // Verify group membership and authorization
        const group = await Group.findById(session.group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const isInitiator = session.initiator_id.toString() === req.user.id;
        const isModerator = group.moderator_ids.some(id => id.toString() === req.user.id);
        const isAdmin = req.user.user_type === 'admin';

        if (!isInitiator && !isModerator && !isAdmin) {
            return sendError(res, 403, 'Not authorized to end this session');
        }

        session.status = 'ended';
        session.ended_at = new Date();
        await session.save();

        logger.info(`Session ended: ${session_id} by ${req.user.id}`);

        sendSuccess(res, 200, 'Session ended successfully');

    } catch (error) {
        sendServerError(res, logger, 'End session error', error);
    }
};

// Get all active sessions for a group
exports.get_active_sessions = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const safe_user_id = toObjectId(req.user.id);

        if (!group_id || !safe_user_id) {
            return sendError(res, 400, 'Group ID is required');
        }

        // Verify user is member of the group
        const group = await Group.findOne({
            _id: group_id,
            $or: [
                { pilgrim_ids: safe_user_id },
                { moderator_ids: safe_user_id }
            ]
        });

        if (!group) {
            return sendError(res, 403, 'Not authorized to view sessions for this group');
        }

        const sessions = await CommunicationSession.find({
            group_id,
            status: 'active'
        })
            .populate('initiator_id', 'full_name user_type')
            .populate('participants.user_id', 'full_name user_type');

        sendSuccess(res, 200, null, { sessions });

    } catch (error) {
        sendServerError(res, logger, 'Get active sessions error', error);
    }
};
