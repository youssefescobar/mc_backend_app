const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');

const initializeSockets = (io) => {
    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.id}`);

        // ── User Registration ──────────────────────────────────────────────────
        socket.on('register-user', async ({ userId, role }) => {
            socket.data.userId = userId;
            socket.data.role = role || 'pilgrim';
            // Join personal room for targeted server-to-client events
            socket.join(`user_${userId}`);
            console.log(`[Socket] User registered: ${userId} (${socket.data.role}) -> ${socket.id}`);

            try {
                if (socket.data.role === 'pilgrim') {
                    await Pilgrim.findByIdAndUpdate(userId, { is_online: true, last_active_at: new Date() });
                } else {
                    await User.findByIdAndUpdate(userId, { is_online: true, last_active_at: new Date() });
                }
            } catch (err) {
                console.error('[Socket] Error updating online status (connect):', err);
            }
        });

        // ── Helper: find socket by userId ──────────────────────────────────────
        function getSocketByUserId(userId) {
            return Array.from(io.sockets.sockets.values()).find(s => s.data.userId === userId);
        }

        // ── Group Rooms ────────────────────────────────────────────────────────
        socket.on('join_group', async (groupId) => {
            if (groupId) {
                socket.join(`group_${groupId}`);
                socket.data.groupId = groupId;
                if (socket.data.userId) {
                    io.to(`group_${groupId}`).emit('status_update', {
                        pilgrimId: socket.data.userId,
                        active: true,
                        last_active_at: new Date()
                    });
                }
                // Sync any currently-active nav beacons to the newly joined client
                try {
                    const roomSockets = await io.in(`group_${groupId}`).fetchSockets();
                    for (const s of roomSockets) {
                        if (s.id !== socket.id && s.data.navBeacon && s.data.navBeacon.groupId === groupId) {
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
                    console.error('[Socket] Error syncing nav beacons on join:', err);
                }
                console.log(`[Socket] User ${socket.id} joined group_${groupId}`);
            }
        });

        socket.on('leave_group', (groupId) => {
            if (groupId) {
                socket.leave(`group_${groupId}`);
                console.log(`[Socket] User ${socket.id} left group_${groupId}`);
            }
        });

        // ── Location Updates ───────────────────────────────────────────────────
        socket.on('update_location', (data) => {
            const { groupId, pilgrimId, battery_percent } = data;
            if (groupId) {
                socket.to(`group_${groupId}`).emit('location_update', data);

                if (battery_percent !== undefined) {
                    const pilgrimSocket = getSocketByUserId(pilgrimId);
                    if (pilgrimSocket) {
                        pilgrimSocket.emit('battery-update', { battery_percent, pilgrimId });
                    }
                }
            }
        });

        // ── SOS Alerts ────────────────────────────────────────────────────────
        socket.on('sos_alert', (data) => {
            const { groupId } = data;
            if (groupId) {
                io.to(`group_${groupId}`).emit('sos-alert-received', data);
                console.log(`[Socket] SOS Alert from ${data.pilgrimId} in group_${groupId}`);
            }
        });

        // ── WebRTC Call Signaling ──────────────────────────────────────────────

        socket.on('call-offer', async ({ to, channelName }) => {
            console.log(`[Socket] Call offer from ${socket.data.userId} to ${to}`);

            const { sendPushNotification } = require('../services/pushNotificationService');
            const CallHistory = require('../models/call_history_model');

            try {
                // Fetch caller info
                let caller = await User.findById(socket.data.userId).select('full_name role');
                if (!caller) caller = await Pilgrim.findById(socket.data.userId).select('full_name role');

                const callerInfo = {
                    id: socket.data.userId,
                    name: caller?.full_name || 'Unknown',
                    role: caller?.role || 'Unknown'
                };
                console.log(`[Socket] Caller info:`, callerInfo);

                // Fetch recipient info (for FCM token)
                let recipient = await User.findById(to).select('fcm_token full_name role');
                if (!recipient) recipient = await Pilgrim.findById(to).select('fcm_token full_name role');

                // Create call history record
                const caller_model = caller?.role === 'pilgrim' ? 'Pilgrim' : 'User';
                const receiver_model = recipient?.role === 'pilgrim' ? 'Pilgrim' : 'User';
                const callRecord = await CallHistory.create({
                    caller_id: socket.data.userId,
                    caller_model,
                    receiver_id: to,
                    receiver_model,
                    call_type: 'internet',
                    status: 'ringing'
                });
                socket.data.currentCallId = callRecord._id;
                console.log(`[Socket] Call record created: ${callRecord._id}`);

                // Check if recipient is reachable via socket.
                // Use the personal room ('user_<id>') rather than a raw scan —
                // the room is joined synchronously in 'register-user' and is
                // more reliable than scanning socket.data fields.
                const recipientSockets = await io.in(`user_${to}`).fetchSockets();
                const isOnline = recipientSockets.length > 0;

                if (isOnline) {
                    // ── Recipient has active socket ──────────────────────────────
                    console.log(`[Socket] Recipient ${to} is in room user_${to} — sending call-offer via socket`);
                    io.to(`user_${to}`).emit('call-offer', { channelName, from: socket.data.userId, callerInfo });
                } else {
                    // ── Recipient has no socket (killed/offline) ─────────────────
                    // Send FCM only. The BackgroundNotificationTask + Notifee will show the call UI.
                    console.log(`[Socket] Recipient ${to} has no socket — sending FCM for call notification`);

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
                                channelName
                            },
                            true // high priority
                        );
                        console.log(`[Socket] ✓ Call FCM sent to ${recipient.full_name}`);
                    } else {
                        console.log(`[Socket] Recipient ${to} has no FCM token — call may be missed`);
                    }
                }

            } catch (error) {
                console.error('[Socket] Error in call-offer handler:', error);
                // Fallback: try to deliver via socket room if possible
                io.to(`user_${to}`).emit('call-offer', { channelName, from: socket.data.userId });
            }
        });

        socket.on('call-answer', async ({ to }) => {
            console.log(`[Socket] Call answer from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-answer', { from: socket.data.userId });

                // Update call record to in-progress
                try {
                    const CallHistory = require('../models/call_history_model');
                    if (target.data.currentCallId) {
                        await CallHistory.findByIdAndUpdate(target.data.currentCallId, {
                            status: 'in-progress',
                            started_at: new Date()
                        });
                        console.log(`[Socket] Call record updated to in-progress`);
                    }
                } catch (error) {
                    console.error('[Socket] Error updating call record:', error);
                }
            } else {
                console.log(`[Socket] Target user ${to} not found for call answer`);
            }
        });

        socket.on('ice-candidate', ({ to, candidate }) => {
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('ice-candidate', { candidate, from: socket.data.userId });
            }
        });

        socket.on('call-declined', async ({ to }) => {
            console.log(`[Socket] Call declined from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-declined', { from: socket.data.userId });

                try {
                    const CallHistory = require('../models/call_history_model');
                    if (target.data.currentCallId) {
                        await CallHistory.findByIdAndUpdate(target.data.currentCallId, {
                            status: 'declined',
                            ended_at: new Date()
                        });
                        console.log(`[Socket] Call record updated to declined`);
                        delete target.data.currentCallId;
                    }
                } catch (error) {
                    console.error('[Socket] Error updating call record:', error);
                }
            }
        });

        socket.on('call-end', async ({ to }) => {
            console.log(`[Socket] Call end from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-end', { from: socket.data.userId });
            }

            try {
                const CallHistory = require('../models/call_history_model');
                const { sendPushNotification } = require('../services/pushNotificationService');

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
                        console.log(`[Socket] Call record updated: ${isMissed ? 'missed' : 'completed'}, duration: ${duration}s`);

                        if (isMissed) {
                            // Emit real-time missed call event so recipient can update their badge
                            const targetSocket = getSocketByUserId(targetUserId);

                            let callerName = 'Someone';
                            if (socket.data.userId === callRecord.caller_id.toString()) {
                                let me = await User.findById(socket.data.userId).select('full_name');
                                if (!me) me = await Pilgrim.findById(socket.data.userId).select('full_name');
                                callerName = me?.full_name || 'Unknown';
                            }

                            if (targetSocket) {
                                targetSocket.emit('missed-call-received', {
                                    callId: callRecord._id.toString(),
                                    callerId: socket.data.userId,
                                    callerName
                                });
                                console.log(`[Socket] ✓ Missed call event emitted to ${targetUserId}`);
                            }

                            // Also send push for missed call (standard notification, not full-screen)
                            let targetUser = await User.findById(targetUserId).select('fcm_token full_name');
                            if (!targetUser) targetUser = await Pilgrim.findById(targetUserId).select('fcm_token full_name');

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
                                console.log(`[Socket] ✓ Missed call notification sent to ${targetUser.full_name}`);
                            }
                        }

                        delete socket.data.currentCallId;
                    }
                }
            } catch (error) {
                console.error('[Socket] Error updating call record on call-end:', error);
            }
        });

        // call-cancel: caller hung up while recipient had a Notifee notification open
        // This tells the recipient's app to dismiss the incoming call notification/UI
        socket.on('call-cancel', ({ to }) => {
            console.log(`[Socket] Call cancelled by ${socket.data.userId}, notifying ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-cancel', { from: socket.data.userId });
            }
        });

        socket.on('call-busy', ({ to }) => {
            console.log(`[Socket] Call busy from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-busy', { from: socket.data.userId });
            }
        });

        // ── Moderator Navigation Beacon ──────────────────────────────────────────
        socket.on('mod_nav_beacon', (data) => {
            const { groupId, enabled, lat, lng, moderatorId, moderatorName } = data;
            if (!groupId) return;
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
            console.log(`[Socket] Nav beacon: ${moderatorId} group_${groupId} -> ${enabled}`);
        });

        // ── Pilgrim SOS Cancel ───────────────────────────────────────
        socket.on('sos_cancel', (data) => {
            const { groupId, pilgrimId } = data;
            if (!groupId) return;
            socket.to(`group_${groupId}`).emit('sos-alert-cancelled', {
                pilgrim_id: pilgrimId || socket.data.userId,
                group_id: groupId,
                timestamp: new Date(),
            });
            console.log(`[Socket] SOS cancelled by ${pilgrimId} in group_${groupId}`);
        });

        // ── Disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', async (reason) => {
            const { userId, role, groupId, navBeacon } = socket.data;
            console.log(`[Socket] User disconnected: ${socket.id} (Reason: ${reason}, User: ${userId})`);

            // Auto-disable nav beacon when moderator disconnects
            if (navBeacon) {
                socket.to(`group_${navBeacon.groupId}`).emit('mod_nav_beacon', {
                    moderatorId: navBeacon.moderatorId,
                    moderatorName: navBeacon.moderatorName,
                    enabled: false,
                    lat: null,
                    lng: null,
                });
                console.log(`[Socket] Auto-disabled nav beacon for ${navBeacon.moderatorId}`);
            }

            if (userId) {
                try {
                    if (role === 'pilgrim') {
                        await Pilgrim.findByIdAndUpdate(userId, { is_online: false, last_active_at: new Date() });
                    } else {
                        await User.findByIdAndUpdate(userId, { is_online: false, last_active_at: new Date() });
                    }

                    if (groupId) {
                        io.to(`group_${groupId}`).emit('status_update', {
                            pilgrimId: userId,
                            active: false,
                            last_active_at: new Date()
                        });
                    }
                } catch (err) {
                    console.error('[Socket] Error updating online status (disconnect):', err);
                }
            }
        });
    });
};

module.exports = { initializeSockets };
