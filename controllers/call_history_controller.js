const CallHistory = require('../models/call_history_model');
const { logger } = require('../config/logger');

// Get call history for current user
exports.get_call_history = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find calls where user is either caller or receiver
        const calls = await CallHistory.find({
            $or: [
                { caller_id: userId },
                { receiver_id: userId }
            ]
        })
            .populate('caller_id', 'full_name role phone_number profile_picture')
            .populate('receiver_id', 'full_name role phone_number profile_picture')
            .sort({ createdAt: -1 })
            .limit(100); // Limit to last 100 calls

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
        const caller_id = req.user.id;
        const caller_model = req.user.role === 'pilgrim' ? 'Pilgrim' : 'User';

        const callRecord = new CallHistory({
            caller_id,
            caller_model,
            receiver_id,
            receiver_model,
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

// Get unread missed call count
exports.get_unread_count = async (req, res) => {
    try {
        const userId = req.user.id;
        const count = await CallHistory.countDocuments({
            receiver_id: userId,
            status: 'missed',
            is_read: false
        });
        res.json({ count });
    } catch (error) {
        logger.error(`Error fetching unread count: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
    }
};

// Mark all missed calls as read
exports.mark_read = async (req, res) => {
    try {
        const userId = req.user.id;
        await CallHistory.updateMany(
            { receiver_id: userId, status: 'missed', is_read: false },
            { is_read: true }
        );
        res.json({ success: true });
    } catch (error) {
        logger.error(`Error marking calls as read: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark calls as read' });
    }
};
// Decline a call from background notification (called via REST when app is backgrounded/killed)
exports.decline_call = async (req, res) => {
    try {
        const { callerId } = req.body;
        if (!callerId) return res.status(400).json({ success: false, message: 'callerId required' });

        // Find the caller's active socket and emit call-declined
        const io = req.app.get('socketio');
        if (io) {
            const callerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.data.userId === callerId);

            if (callerSocket) {
                callerSocket.emit('call-declined', { from: 'background' });
                console.log(`[API] call-declined emitted to caller ${callerId}`);
            } else {
                console.log(`[API] Caller ${callerId} socket not found (may have disconnected)`);
            }
        }

        // Mark any ringing call records as declined
        const CallHistory = require('../models/call_history_model');
        await CallHistory.updateMany(
            { caller_id: callerId, status: 'ringing' },
            { status: 'declined', ended_at: new Date() }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error declining call:', error);
        res.status(500).json({ success: false, message: 'Failed to decline call' });
    }
};
