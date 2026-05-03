const mongoose = require('mongoose');
const User = require('../models/user_model');
const Notification = require('../models/notification_model');

function toObjectIdString(callerId) {
    const raw =
        callerId && typeof callerId === 'object' && callerId !== null
            ? callerId._id ?? callerId.id ?? callerId
            : callerId;
    const id = raw != null ? String(raw) : '';
    if (!id || id === 'undefined') return '';
    return id;
}

/** Resolve display name: unified [User] first; optional legacy `Pilgrim` model if registered. */
async function resolveCallerDisplayName(callerId) {
    const id = toObjectIdString(callerId);
    if (!id) return 'Someone';

    let caller = await User.findById(id).select('full_name');
    if (caller?.full_name) return caller.full_name;

    const PilgrimLegacy = mongoose.models.Pilgrim;
    if (PilgrimLegacy) {
        caller = await PilgrimLegacy.findById(id).select('full_name');
        if (caller?.full_name) return caller.full_name;
    }

    return 'Someone';
}

/**
 * Persist missed-call notification + realtime + FCM for the callee who did not answer.
 * @param {import('socket.io').Server} io
 * @param {(userId: string) => import('socket.io').Socket | undefined} getSocketByUserId
 * @param {{ receiverId: string, callerId: string, callId: string }} params
 */
async function notifyMissedCallForReceiver(io, getSocketByUserId, { receiverId, callerId, callId }) {
    const callerName = await resolveCallerDisplayName(callerId);

    await Notification.create({
        user_id: receiverId,
        type: 'missed_call',
        title: 'Missed Call',
        message: `You missed a call from ${callerName}`,
        data: { caller_id: callerId, caller_name: callerName },
    });

    if (io) {
        try {
            io.to(`user_${String(receiverId)}`).emit('notification_refresh', {});
        } catch (e) {
            console.error('[missedCallNotify] notification_refresh emit failed:', e?.message);
        }
    }

    if (typeof getSocketByUserId === 'function') {
        const targetSocket = getSocketByUserId(String(receiverId));
        if (targetSocket) {
            targetSocket.emit('missed-call-received', {
                callId,
                callerId,
                callerName,
            });
        }
    }

    const { sendPushNotification } = require('./pushNotificationService');
    const receiverDbId = toObjectIdString(receiverId) || String(receiverId || '');
    const ru = await User.findById(receiverDbId).select('fcm_token full_name');
    if (ru?.fcm_token) {
        await sendPushNotification(
            [ru.fcm_token],
            'Missed Call',
            `You missed a call from ${callerName}`,
            {
                type: 'missed_call',
                callId,
                callerId,
                callerName,
            },
        );
    }
}

module.exports = { notifyMissedCallForReceiver };
