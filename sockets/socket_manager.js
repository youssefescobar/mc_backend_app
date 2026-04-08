const User = require('../models/user_model');
const Group = require('../models/group_model');
const CallHistory = require('../models/call_history_model');
const Notification = require('../models/notification_model');
const { sendPushNotification } = require('../services/pushNotificationService');
const { logger } = require('../config/logger');
const rateLimiter = require('../middleware/socket_rate_limiter');
const { validateSocketEvent } = require('../middleware/socket_validation');
const cache = require('../services/cacheService');

// ══════════════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get user from cache or database
 * @param {string} userId - User ID
 * @param {string} selectFields - Optional fields to select (e.g., 'fcm_token full_name')
 * @returns {Promise<Object|null>} User object or null
 */
async function getCachedUser(userId, selectFields = null) {
    // Use field-specific cache key if selecting specific fields
    const cacheKey = selectFields 
        ? cache.key('user', `${userId}:${selectFields.replace(/\s+/g, ',')}`)
        : cache.key('user', userId);
    
    return await cache.getOrSet(
        cacheKey,
        async () => {
            let query = User.findById(userId);
            if (selectFields) {
                query = query.select(selectFields);
            }
            return await query.lean();
        },
        cache.TTL.USER // 5 minutes
    );
}

/**
 * Get group from cache or database
 * @param {string} groupId - Group ID
 * @returns {Promise<Object|null>} Group object or null
 */
async function getCachedGroup(groupId) {
    return await cache.getOrSet(
        cache.key('group', groupId),
        async () => await Group.findById(groupId).lean(),
        cache.TTL.GROUP // 3 minutes
    );
}

/**
 * Get group members (pilgrim IDs) from cache
 * @param {string} groupId - Group ID
 * @returns {Promise<string[]>} Array of pilgrim IDs
 */
async function getCachedGroupMembers(groupId) {
    return await cache.getOrSet(
        cache.key('group:members', groupId),
        async () => {
            const group = await Group.findById(groupId).select('pilgrim_ids moderator_ids').lean();
            if (!group) return [];
            return {
                pilgrimIds: (group.pilgrim_ids || []).map(id => id.toString()),
                moderatorIds: (group.moderator_ids || []).map(id => id.toString())
            };
        },
        cache.TTL.GROUP
    );
}

const initializeSockets = (io) => {
    io.on('connection', (socket) => {
        // User is already authenticated via socketAuthMiddleware
        // socket.data.userId and socket.data.role are set
        const { userId, role } = socket.data;
        
        logger.info(`[Socket] User connected: ${userId} (${role}) -> ${socket.id}`);

        // Join personal room for targeted server-to-client events
        socket.join(`user_${userId}`);

        // Update online status
        User.findByIdAndUpdate(userId, { 
            is_online: true, 
            last_active_at: new Date() 
        }).then(() => {
            // Invalidate user cache since online status changed
            cache.delete(cache.key('user', userId));
        }).catch(err => {
            logger.error(`[Socket] Error updating online status for ${userId}:`, err);
        });

        // ── Helper Functions ───────────────────────────────────────────────────
        
        /**
         * Validate and rate limit socket event
         * @param {string} eventName - Name of the event
         * @param {any} data - Event data
         * @param {number} rateLimit - Max events per minute (default: 60)
         * @returns {Object|null} - Validated data or null if invalid/rate limited
         */
        function validateAndRateLimit(eventName, data, rateLimit = 60) {
            // Check rate limit
            if (!rateLimiter.check(socket.id, eventName, rateLimit)) {
                socket.emit('error', { 
                    type: 'rate_limit',
                    message: `Too many '${eventName}' events. Please slow down.` 
                });
                return null;
            }

            // Validate event data
            const { valid, error, value } = validateSocketEvent(eventName, data);
            if (!valid) {
                logger.warn(`[Socket] Invalid data for '${eventName}' from ${userId}: ${error}`);
                socket.emit('error', { 
                    type: 'validation_error',
                    message: `Invalid data for ${eventName}: ${error}` 
                });
                return null;
            }

            return value;
        }

        /**
         * Find socket by userId (helper for direct messaging)
         */
        async function getSocketByUserId(targetUserId) {
            const sockets = await io.in(`user_${targetUserId}`).fetchSockets();
            return sockets[0] || null;
        }

        // ── Group Rooms ────────────────────────────────────────────────────────
        socket.on('join_group', async (groupId) => {
            // Validate input
            const validated = validateAndRateLimit('join_group', groupId, 10); // Max 10 joins/min
            if (!validated) return;
            
            socket.join(`group_${validated}`);
            socket.data.groupId = validated;
            
            io.to(`group_${validated}`).emit('status_update', {
                pilgrimId: userId,
                active: true,
                last_active_at: new Date()
            });
            
            // Sync any currently-active nav beacons to the newly joined client
            try {
                const roomSockets = await io.in(`group_${validated}`).fetchSockets();
                for (const s of roomSockets) {
                    if (s.id !== socket.id && s.data.navBeacon && s.data.navBeacon.groupId === validated) {
                        socket.emit('mod_nav_beacon', {
                            moderatorId: s.data.navBeacon.moderatorId,
                            moderatorName: s.data.navBeacon.moderatorName,
                            enabled: true,
                            lat: s.data.navBeacon.lat,
                            lng: s.data.navBeacon.lng,
                        });
                    }
                }
            } catch (err) {
                logger.error(`[Socket] Error syncing nav beacons for ${userId}:`, err);
            }
            
            logger.debug(`[Socket] User ${userId} joined group_${validated}`);
        });

        socket.on('leave_group', (groupId) => {
            const validated = validateAndRateLimit('leave_group', groupId, 10);
            if (!validated) return;
            
            socket.leave(`group_${validated}`);
            logger.debug(`[Socket] User ${userId} left group_${validated}`);
        });

        // ── Location Updates ───────────────────────────────────────────────────
        socket.on('update_location', async (data) => {
            // Rate limit: max 60 location updates per minute (1 per second)
            const validated = validateAndRateLimit('update_location', data, 60);
            if (!validated) return;
            
            const { groupId, pilgrimId, battery_percent } = validated;
            if (groupId) {
                socket.to(`group_${groupId}`).emit('location_update', validated);

                if (battery_percent !== undefined) {
                    const pilgrimSocket = await getSocketByUserId(pilgrimId);
                    if (pilgrimSocket) {
                        pilgrimSocket.emit('battery-update', { battery_percent, pilgrimId });
                    }
                }
            }
        });

        // ── SOS Alerts ────────────────────────────────────────────────────────
        socket.on('sos_alert', (data) => {
            // Rate limit: max 5 SOS alerts per minute (prevent spam)
            const validated = validateAndRateLimit('sos_alert', data, 5);
            if (!validated) return;
            
            const { groupId, pilgrimId } = validated;
            if (groupId) {
                io.to(`group_${groupId}`).emit('sos-alert-received', validated);
                logger.info(`[Socket] SOS Alert from ${pilgrimId} in group_${groupId}`);
            }
        });

        // ── Agora Call Signaling ───────────────────────────────────────────────
        // NOTE: We use Agora SDK for audio/video streaming. Agora handles ALL
        // WebRTC signaling internally (ICE candidates, SDP offer/answer, STUN/TURN).
        // These socket events ONLY manage call state (ringing, accepted, ended).
        // Both users join the same Agora channel, and Agora cloud routes media.

        socket.on('call-offer', async (data) => {
            // Validate and rate limit (max 5 call attempts per minute)
            const validated = validateAndRateLimit('call-offer', data, 5);
            if (!validated) return;
            
            const { to, channelName } = validated;
            logger.info(`[Socket] Call offer from ${userId} to ${to}`);

            try {
                // Fetch caller info from cache
                const caller = await getCachedUser(socket.data.userId);

                const callerInfo = {
                    id: socket.data.userId,
                    name: caller?.full_name || 'Unknown',
                    role: caller?.user_type || 'Unknown'
                };
                logger.debug(`[Socket] Caller info: ${JSON.stringify(callerInfo)}`);

                // Fetch recipient info from cache (for FCM token)
                const recipient = await getCachedUser(to);

                // Create call history record
                const callRecord = await CallHistory.create({
                    caller_id: socket.data.userId,
                    caller_model: 'User',
                    receiver_id: to,
                    receiver_model: 'User',
                    call_type: 'internet',
                    status: 'ringing'
                });
                socket.data.currentCallId = callRecord._id;
                logger.debug(`[Socket] Call record created: ${callRecord._id}`);

                // ── Server-side ring timeout ─────────────────────────────────
                // When the recipient's app is killed, the Flutter engine may not
                // start on decline, so the client-side HTTP fallback never fires.
                // This server timeout is the safety net: after 35 s, if the call
                // is still "ringing", mark it as missed and notify the caller.
                if (socket.data.callRingTimeout) clearTimeout(socket.data.callRingTimeout);
                const callRecordId = callRecord._id;
                const callerId = socket.data.userId;
                const receiverId = to;
                socket.data.callRingTimeout = setTimeout(async () => {
                    try {
                        const record = await CallHistory.findById(callRecordId);
                        if (!record || record.status !== 'ringing') return;

                        logger.info(`[Socket] ⏰ Ring timeout for call ${callRecordId} — marking as missed`);

                        await CallHistory.findByIdAndUpdate(callRecordId, {
                            status: 'missed',
                            ended_at: new Date()
                        });

                        // Tell the caller the call was not answered
                        const callerRoom = `user_${callerId}`;
                        io.to(callerRoom).emit('call-declined', { from: receiverId });
                        logger.info(`[Socket] ⏰ Emitted call-declined to caller ${callerId}`);

                        // ── Also send a silent FCM to the MODERATOR (caller) as a guaranteed fallback.
                        // Even if the socket.emit above is missed (e.g. brief reconnect), the FCM
                        // wakes up the Flutter foreground handler and stops the ringing.
                        try {
                            const callerUser = await getCachedUser(callerId, 'fcm_token full_name');
                            if (callerUser?.fcm_token) {
                                await sendPushNotification(
                                    [callerUser.fcm_token],
                                    'Call Not Answered',
                                    'The call was not answered',
                                    {
                                        type: 'call_declined',
                                        callerId: receiverId,   // who declined (pilgrim)
                                        callRecordId: callRecordId.toString()
                                    },
                                    true // high priority data-only
                                );
                                logger.info(`[Socket] ⏰ call_declined FCM sent to moderator ${callerUser.full_name}`);
                            }
                        } catch (fcmCallerErr) {
                            logger.error('[Socket] ⏰ Error sending call_declined FCM to caller:', fcmCallerErr);
                        }

                        // Clean up caller socket's currentCallId
                        const callerSockets = await io.in(callerRoom).fetchSockets();
                        for (const s of callerSockets) {
                            delete s.data.currentCallId;
                            delete s.data.callRingTimeout;
                        }

                        // Dismiss the native call screen on receiver's device(s)
                        try {
                            const rcpt = await getCachedUser(receiverId, 'fcm_token full_name');
                            if (rcpt?.fcm_token) {
                                await sendPushNotification(
                                    [rcpt.fcm_token],
                                    'Call Cancelled',
                                    'Caller ended the call',
                                    { type: 'call_cancel', callerId },
                                    true
                                );
                                logger.info(`[Socket] ⏰ call_cancel FCM sent to ${rcpt.full_name}`);
                            }
                        } catch (fcmErr) {
                            logger.error('[Socket] ⏰ Error sending timeout call_cancel FCM:', fcmErr);
                        }

                        // Create missed-call notification for receiver
                        try {
                            await Notification.create({
                                user_id: receiverId,
                                type: 'missed_call',
                                title: 'Missed Call',
                                message: `You missed a call from ${callerInfo.name}`,
                                data: { caller_id: callerId, caller_name: callerInfo.name }
                            });
                        } catch (notifErr) {
                            logger.error('[Socket] ⏰ Error creating missed-call notification:', notifErr);
                        }
                    } catch (err) {
                        logger.error('[Socket] ⏰ Ring timeout handler error:', err);
                    }
                }, 30000); // ← 30 s matches the CallKit native ring duration

                // Check if recipient is reachable via socket.
                // Use the personal room ('user_<id>') rather than a raw scan —
                // the room is joined synchronously in 'register-user' and is
                // more reliable than scanning socket.data fields.
                const recipientSockets = await io.in(`user_${to}`).fetchSockets();
                const isOnline = recipientSockets.length > 0;

                if (isOnline) {
                    // ── Recipient has active socket ──────────────────────────────
                    logger.debug(`[Socket] Recipient ${to} is in room user_${to} — sending call-offer via socket`);
                    io.to(`user_${to}`).emit('call-offer', { channelName, from: socket.data.userId, callerInfo });
                } else {
                    // ── Recipient has no socket (killed/offline) ─────────────────
                    // Send FCM only. The BackgroundNotificationTask + Notifee will show the call UI.
                    logger.debug(`[Socket] Recipient ${to} has no socket — sending FCM for call notification`);

                    if (recipient?.fcm_token) {
                        await sendPushNotification(
                            [recipient.fcm_token],
                            callerInfo.name,
                            `Incoming call`,
                            {
                                type: 'incoming_call',
                                callerId: socket.data.userId,
                                callerName: callerInfo.name,
                                callerRole: callerInfo.role,
                                channelName,
                                callRecordId: callRecord._id.toString()
                            },
                            true // high priority
                        );
                        logger.info(`[Socket] ✓ Call FCM sent to ${recipient.full_name}`);
                    } else {
                        logger.warn(`[Socket] Recipient ${to} has no FCM token — call may be missed`);
                    }
                }

            } catch (error) {
                logger.error('[Socket] Error in call-offer handler:', error);
                // Do NOT fallback with another emit — it could duplicate the call
                // if the try block partially succeeded.
            }
        });

        socket.on('call-answer', async ({ to }) => {
            logger.debug(`[Socket] Call answer from ${socket.data.userId} to ${to}`);
            // Clear the caller's ring timeout — the call was answered
            const callerSocket = await getSocketByUserId(to);
            if (callerSocket?.data?.callRingTimeout) {
                clearTimeout(callerSocket.data.callRingTimeout);
                delete callerSocket.data.callRingTimeout;
            }
            const target = callerSocket || await getSocketByUserId(to);
            if (target) {
                logger.debug(`[Socket] Relaying call-answer to socket ${target.id}`);
                target.emit('call-answer', { from: socket.data.userId });

                // Update call record to in-progress
                try {
                    if (target.data.currentCallId) {
                        await CallHistory.findByIdAndUpdate(target.data.currentCallId, {
                            status: 'in-progress',
                            started_at: new Date()
                        });
                        logger.debug(`[Socket] Call record updated to in-progress`);
                    }
                } catch (error) {
                    logger.error('[Socket] Error updating call record:', error);
                }
            } else {
                logger.debug(`[Socket] Target user ${to} not found for call answer`);
            }
        });

        socket.on('call-declined', async ({ to }) => {
            logger.debug(`[Socket] Call declined from ${socket.data.userId} to ${to}`);
            // Clear the caller's ring timeout — decline was explicit
            const callerSock = await getSocketByUserId(to);
            if (callerSock?.data?.callRingTimeout) {
                clearTimeout(callerSock.data.callRingTimeout);
                delete callerSock.data.callRingTimeout;
            }
            const callerRoom = `user_${to}`;
            const callerSockets = await io.in(callerRoom).fetchSockets();
            if (callerSockets.length > 0) {
                logger.debug(`[Socket] Relaying call-declined to ${callerSockets.length} caller socket(s) in ${callerRoom}`);
                io.to(callerRoom).emit('call-declined', { from: socket.data.userId });

                // Only update the call record status — do NOT create a missed-call
                // notification or send FCM here. The caller's 'call-end' event is
                // the single authoritative source for missed-call notifications,
                // avoiding duplicate notifications when the receiver's CallKit
                // dismisses and triggers an automatic decline signal.
                try {
                    if (callerSock?.data?.currentCallId) {
                        await CallHistory.findByIdAndUpdate(callerSock.data.currentCallId, {
                            status: 'declined',
                            ended_at: new Date()
                        });
                        logger.debug(`[Socket] Call record updated to declined`);
                        delete callerSock.data.currentCallId;
                    }
                } catch (error) {
                    logger.error('[Socket] Error updating call record:', error);
                }
            } else {
                logger.debug(`[Socket] Caller user ${to} not found for call-declined`);
            }
        });

        socket.on('call-end', async ({ to }) => {
            logger.debug(`[Socket] Call end from ${socket.data.userId} to ${to}`);
            // Clear ring timeout on both sides
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }
            const target = await getSocketByUserId(to);
            if (target?.data?.callRingTimeout) {
                clearTimeout(target.data.callRingTimeout);
                delete target.data.callRingTimeout;
            }
            if (target) {
                target.emit('call-end', { from: socket.data.userId });
            }

            try {
                if (socket.data.currentCallId) {
                    const callRecord = await CallHistory.findById(socket.data.currentCallId);
                    if (callRecord) {
                        const isMissed = callRecord.status === 'ringing';
                        const duration = callRecord.started_at
                            ? Math.floor((new Date() - callRecord.started_at) / 1000)
                            : 0;

                        let targetUserId = callRecord.receiver_id.toString();
                        if (socket.data.userId === targetUserId) {
                            targetUserId = callRecord.caller_id.toString();
                        }

                        await CallHistory.findByIdAndUpdate(socket.data.currentCallId, {
                            status: isMissed ? 'missed' : 'completed',
                            ended_at: new Date(),
                            duration
                        });
                        logger.debug(`[Socket] Call record updated: ${isMissed ? 'missed' : 'completed'}, duration: ${duration}s`);

                        if (isMissed) {
                            // Fetch caller name from cache
                            let callerName = 'Someone';
                            if (socket.data.userId === callRecord.caller_id.toString()) {
                                let me = await getCachedUser(socket.data.userId, 'full_name');
                                callerName = me?.full_name || 'Unknown';
                            }

                            // ── Create a persistent Notification doc for the recipient ──
                            await Notification.create({
                                user_id: targetUserId,
                                type: 'missed_call',
                                title: 'Missed Call',
                                message: `You missed a call from ${callerName}`,
                                data: {
                                    caller_id: socket.data.userId,
                                    caller_name: callerName
                                }
                            });
                            logger.info(`[Socket] ✓ Missed call notification doc created for ${targetUserId}`);

                            // Emit real-time missed call event so recipient can update their badge
                            const targetSocket = await getSocketByUserId(targetUserId);

                            if (targetSocket) {
                                targetSocket.emit('missed-call-received', {
                                    callId: callRecord._id.toString(),
                                    callerId: socket.data.userId,
                                    callerName
                                });
                                logger.info(`[Socket] ✓ Missed call event emitted to ${targetUserId}`);
                            }

                            // Also send push for missed call (standard notification, not full-screen)
                            let targetUser = await getCachedUser(targetUserId, 'fcm_token full_name');

                            if (targetUser?.fcm_token) {
                                await sendPushNotification(
                                    [targetUser.fcm_token],
                                    'Missed Call',
                                    `You missed a call from ${callerName}`,
                                    {
                                        type: 'missed_call',
                                        callId: callRecord._id.toString(),
                                        callerId: socket.data.userId,
                                        callerName
                                    }
                                );
                                logger.info(`[Socket] ✓ Missed call notification sent to ${targetUser.full_name}`);
                            }
                        }

                        delete socket.data.currentCallId;
                    }
                }
            } catch (error) {
                logger.error('[Socket] Error updating call record on call-end:', error);
            }
        });

        // call-cancel: caller hung up while recipient had a Notifee notification open
        // This tells the recipient's app to dismiss the incoming call notification/UI
        socket.on('call-cancel', async ({ to }) => {
            logger.debug(`[Socket] Call cancelled by ${socket.data.userId}, notifying ${to}`);
            // Clear ring timeout — caller cancelled
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }
            const target = await getSocketByUserId(to);
            if (target) {
                target.emit('call-cancel', { from: socket.data.userId });
            } else {
                // Recipient has no active socket (killed/offline) — send high-priority
                // data-only FCM so Flutter background handler can dismiss CallKit UI.
                try {
                    const recipient = await getCachedUser(to, 'fcm_token full_name');
                    if (recipient?.fcm_token) {
                        await sendPushNotification(
                            [recipient.fcm_token],
                            'Call Cancelled',
                            'Caller ended the call',
                            {
                                type: 'call_cancel',
                                callerId: socket.data.userId,
                            },
                            true
                        );
                        logger.info(`[Socket] ✓ call_cancel FCM sent to ${recipient.full_name}`);
                    } else {
                        logger.debug(`[Socket] Recipient ${to} has no FCM token for call_cancel`);
                    }
                } catch (err) {
                    logger.error('[Socket] Error sending call_cancel FCM:', err);
                }
            }
        });

        socket.on('call-busy', async ({ to }) => {
            logger.debug(`[Socket] Call busy from ${socket.data.userId} to ${to}`);
            const target = await getSocketByUserId(to);
            if (target) {
                target.emit('call-busy', { from: socket.data.userId });
            }
        });

        // ── Moderator Navigation Beacon ──────────────────────────────────────────
        socket.on('mod_nav_beacon', (data) => {
            // Rate limit: max 30 beacon updates per minute
            const validated = validateAndRateLimit('mod_nav_beacon', data, 30);
            if (!validated) return;
            
            const { groupId, enabled, lat, lng, moderatorId, moderatorName } = validated;
            
            // Ensure moderator is in the group room so they receive future events
            socket.join(`group_${groupId}`);
            socket.data.groupId = groupId;
            
            // Store beacon state for auto-disable on disconnect
            socket.data.navBeacon = enabled
                ? { groupId, moderatorId: moderatorId || socket.data.userId, moderatorName: moderatorName || 'Moderator', lat, lng }
                : null;
            
            // Relay to all other members of the group
            socket.to(`group_${groupId}`).emit('mod_nav_beacon', {
                moderatorId: moderatorId || socket.data.userId,
                moderatorName: moderatorName || 'Moderator',
                enabled,
                lat: enabled ? lat : null,
                lng: enabled ? lng : null,
            });
            logger.debug(`[Socket] Nav beacon: ${moderatorId} group_${groupId} -> ${enabled}`);
        });

        // ── Pilgrim SOS Cancel ───────────────────────────────────────
        socket.on('sos_cancel', (data) => {
            // Rate limit: max 5 SOS cancels per minute
            const validated = validateAndRateLimit('sos_cancel', data, 5);
            if (!validated) return;
            
            const { groupId, pilgrimId } = validated;
            socket.to(`group_${groupId}`).emit('sos-alert-cancelled', {
                pilgrim_id: pilgrimId || socket.data.userId,
                group_id: groupId,
                timestamp: new Date(),
            });
            logger.info(`[Socket] SOS cancelled by ${pilgrimId} in group_${groupId}`);
        });

        // ── Disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', async (reason) => {
            const { userId, role, groupId, navBeacon } = socket.data;
            logger.info(`[Socket] User disconnected: ${userId} (${role}) - Reason: ${reason}`);

            // Clean up rate limiter history
            rateLimiter.removeSocket(socket.id);

            // Clear all pending timeouts to prevent memory leaks
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }

            // Auto-disable nav beacon when moderator disconnects
            if (navBeacon) {
                socket.to(`group_${navBeacon.groupId}`).emit('mod_nav_beacon', {
                    moderatorId: navBeacon.moderatorId,
                    moderatorName: navBeacon.moderatorName,
                    enabled: false,
                    lat: null,
                    lng: null,
                });
                logger.debug(`[Socket] Auto-disabled nav beacon for ${navBeacon.moderatorId}`);
            }

            // Update online status if user disconnected
            if (userId) {
                try {
                    const remainingSockets = await io.in(`user_${userId}`).fetchSockets();
                    
                    // Only set offline if no other sockets for this user
                    if (remainingSockets.length === 0) {
                        await User.findByIdAndUpdate(userId, {
                            is_online: false,
                            last_active_at: new Date()
                        });
                        
                        // Invalidate user cache since online status changed
                        await cache.delete(cache.key('user', userId));

                        // Notify group members if user was in a group
                        if (groupId) {
                            io.to(`group_${groupId}`).emit('status_update', {
                                pilgrimId: userId,
                                active: false,
                                last_active_at: new Date()
                            });
                        }
                    }
                } catch (err) {
                    logger.error(`[Socket] Error updating online status for ${userId}:`, err);
                }
            }
        });
    });
};

module.exports = { initializeSockets };
