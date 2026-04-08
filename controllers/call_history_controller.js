const CallHistory = require('../models/call_history_model');
const mongoose = require('mongoose');
const { logger } = require('../config/logger');
const cache = require('../services/cacheService');

const toObjectId = (value) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

// Helper to invalidate user's call history cache
async function invalidateCallHistoryCache(userId) {
    await cache.deletePattern(`call_history:${userId}*`);
}

// Get call history for current user (cached for 60s)
exports.get_call_history = async (req, res) => {
    try {
        const userId = toObjectId(req.user.id);
        if (!userId) return res.status(400).json({ success: false, message: 'Invalid user identifier' });

        const calls = await cache.getOrSet(
            cache.key('call_history', `${userId}:list`),
            async () => {
                return await CallHistory.find({
                    $or: [
                        { caller_id: userId },
                        { receiver_id: userId }
                    ]
                })
                    .populate('caller_id', 'full_name user_type phone_number profile_picture')
                    .populate('receiver_id', 'full_name user_type phone_number profile_picture')
                    .sort({ createdAt: -1 })
                    .limit(100)
                    .lean();
            },
            60 // 60 second TTL
        );

        logger.info(`[CallHistory] Fetched ${calls.length} calls for user ${userId}`);
        res.json(calls);
    } catch (error) {
        logger.error(`Error fetching call history: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch call history' });
    }
};

// Create call record (used internally by socket handlers)
exports.create_call_record = async (req, res) => {
    try {
        const { receiver_id, receiver_model, call_type } = req.body;
        const caller_id = toObjectId(req.user.id);
        const safe_receiver_id = toObjectId(receiver_id);
        if (!caller_id || !safe_receiver_id) {
            return res.status(400).json({ success: false, message: 'Invalid caller or receiver identifier' });
        }
        const caller_model = 'User';

        const callRecord = new CallHistory({
            caller_id,
            caller_model,
            receiver_id: safe_receiver_id,
            receiver_model: 'User',
            call_type: call_type || 'internet',
            status: 'ringing'
        });

        await callRecord.save();
        res.status(201).json(callRecord);
    } catch (error) {
        logger.error(`Error creating call record: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to create call record' });
    }
};

// Get unread missed call count (cached for 30s)
exports.get_unread_count = async (req, res) => {
    try {
        const userId = toObjectId(req.user.id);
        if (!userId) return res.status(400).json({ success: false, message: 'Invalid user identifier' });
        
        const count = await cache.getOrSet(
            cache.key('call_history', `${userId}:missed_unread`),
            async () => await CallHistory.countDocuments({
                receiver_id: userId,
                status: 'missed',
                is_read: false
            }),
            30 // 30 second TTL for counts
        );
        
        res.json({ count });
    } catch (error) {
        logger.error(`Error fetching unread count: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
    }
};

// Mark all missed calls as read
exports.mark_read = async (req, res) => {
    try {
        const userId = toObjectId(req.user.id);
        if (!userId) return res.status(400).json({ success: false, message: 'Invalid user identifier' });
        await CallHistory.updateMany(
            { receiver_id: userId, status: 'missed', is_read: false },
            { is_read: true }
        );
        
        // Invalidate cache
        await invalidateCallHistoryCache(userId);
        
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error marking calls as read: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark calls as read' });
    }
};
// Check if a call from a specific caller is still active (ringing or in-progress).
// No auth required — used by the killed-state accept flow to verify the call
// hasn't been cancelled before joining the Agora channel.
exports.check_call_active = async (req, res) => {
    try {
        const callerId = toObjectId(req.query.callerId);
        if (!callerId) {
            return res.json({ active: false, status: 'none' });
        }

        const activeCall = await CallHistory.findOne({
            caller_id: callerId,
            status: { $in: ['ringing', 'in-progress'] }
        }).sort({ createdAt: -1 });

        res.json({
            active: !!activeCall,
            status: activeCall?.status || 'none',
            callRecordId: activeCall?._id?.toString() || null
        });
    } catch (error) {
        logger.error(`Error checking call status: ${error.message}`);
        res.status(500).json({ active: false, status: 'error' });
    }
};

// Answer a call from background/killed state (REST fallback when socket isn't connected)
exports.answer_call = async (req, res) => {
    try {
        const callerId = toObjectId(req.body.callerId);
        const answererId = toObjectId(req.body.answererId);
        logger.info(`[API] /call-history/answer hit: callerId=${callerId || ''}, answererId=${answererId || ''}`);
        if (!callerId) return res.status(400).json({ success: false, message: 'callerId required' });

        // Find the caller's active socket and emit call-answer
        const io = req.app.get('socketio');
        if (io) {
            const callerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.data.userId === callerId.toString());

            if (callerSocket) {
                callerSocket.emit('call-answer', { from: answererId?.toString() || 'background' });
                logger.info(`[API] call-answer emitted to caller ${callerId} from ${answererId?.toString() || 'background'}`);
            } else {
                logger.warn(`[API] Caller ${callerId} socket not found for call-answer (may have disconnected)`);
            }
        }

        // Update any ringing call records to in-progress
        await CallHistory.updateMany(
            { caller_id: callerId, status: 'ringing' },
            { status: 'in-progress', answered_at: new Date() }
        );

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error answering call via REST: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to answer call' });
    }
};

// Decline a call from background/killed state (REST fallback when socket isn't connected)
exports.decline_call = async (req, res) => {
    try {
        let callerId = toObjectId(req.body.callerId);
        let declinerId = toObjectId(req.body.declinerId);
        let callRecordId = toObjectId(req.body.callRecordId);
        logger.info(`[API] /call-history/decline hit: callerId=${callerId || ''}, declinerId=${declinerId || ''}, callRecordId=${callRecordId || ''}`);

        // Resolve decliner from payload when present, otherwise infer from the
        // most recent ringing call record.
        let resolvedDeclinerId = declinerId || null;

        if ((!callerId || !resolvedDeclinerId) && callRecordId) {
            const callRecord = await CallHistory.findById(callRecordId)
                .select('caller_id receiver_id status');
            if (callRecord) {
                callerId = callerId || callRecord.caller_id || null;
                resolvedDeclinerId =
                    resolvedDeclinerId ||
                    callRecord.receiver_id ||
                    null;
            }
        }

        if (!callerId) {
            return res.status(400).json({ success: false, message: 'callerId or callRecordId required' });
        }

        if (!resolvedDeclinerId) {
            const ringingCall = await CallHistory.findOne({
                caller_id: callerId,
                status: 'ringing'
            }).sort({ createdAt: -1 });
            resolvedDeclinerId = ringingCall?.receiver_id || null;
            callRecordId = callRecordId || ringingCall?._id || null;
        }

        // Emit to all caller sockets so every logged-in caller device updates.
        const io = req.app.get('socketio');
        if (io) {
            const callerRoom = `user_${callerId.toString()}`;
            const callerSockets = await io.in(callerRoom).fetchSockets();

            if (callerSockets.length > 0) {
                io.to(callerRoom).emit('call-declined', { from: resolvedDeclinerId?.toString() || 'background' });
                logger.info(`[API] call-declined emitted to ${callerSockets.length} caller socket(s) for ${callerId} from ${resolvedDeclinerId?.toString() || 'background'}`);

                // Clear the server ring timeout so it doesn't also fire
                for (const s of callerSockets) {
                    if (s.data?.callRingTimeout) {
                        clearTimeout(s.data.callRingTimeout);
                        delete s.data.callRingTimeout;
                    }
                }
            } else {
                logger.warn(`[API] Caller ${callerId} socket not found for call-declined (may have disconnected)`);
            }

            // Stop ringing on the decliner's other active devices.
            if (resolvedDeclinerId) {
                const declinerRoom = `user_${resolvedDeclinerId.toString()}`;
                const declinerSockets = await io.in(declinerRoom).fetchSockets();
                if (declinerSockets.length > 0) {
                    io.to(declinerRoom).emit('call-cancel', { from: callerId.toString() });
                    logger.info(`[API] call-cancel emitted to ${declinerSockets.length} decliner socket(s) for ${resolvedDeclinerId}`);
                }
            }
        }

        // Mark any ringing call records as declined
        if (callRecordId) {
            await CallHistory.updateOne(
                { _id: callRecordId },
                { status: 'declined', ended_at: new Date() }
            );
        } else {
            await CallHistory.updateMany(
                { caller_id: callerId, status: 'ringing' },
                { status: 'declined', ended_at: new Date() }
            );
        }

        res.json({ success: true });
    } catch (error) {
        logger.error(`Error declining call via REST: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to decline call' });
    }
};
