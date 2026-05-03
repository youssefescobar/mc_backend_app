const User = require('../models/user_model');
const { notifyMissedCallForReceiver } = require('../services/missedCallNotify');

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
                await User.findByIdAndUpdate(userId, { is_online: true, last_active_at: new Date() });
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
                // Sync any currently-active nav beacons to the newly joined client.
                // Search ALL connected sockets (not just room members) because the
                // moderator may have navigated away from the group screen and emitted
                // leave_group — removing them from the room — while their beacon is
                // still active on their socket.data.navBeacon.
                try {
                    const allSockets = await io.fetchSockets();
                    let syncCount = 0;
                    for (const s of allSockets) {
                        const beacon = s.data.navBeacon;
                        if (s.id !== socket.id && beacon && String(beacon.groupId) === String(groupId)) {
                            socket.emit('mod_nav_beacon', {
                                moderatorId: beacon.moderatorId,
                                moderatorName: beacon.moderatorName,
                                enabled: true,
                                lat: beacon.lat,
                                lng: beacon.lng,
                            });
                            syncCount++;
                        }
                    }
                    if (syncCount > 0) {
                        console.log(`[Socket] Synced ${syncCount} active beacons to user ${socket.id} for group_${groupId}`);
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
                // Fetch caller info (don't use .select() to preserve virtual 'role' property)
                const caller = await User.findById(socket.data.userId);

                const callerInfo = {
                    id: socket.data.userId,
                    name: caller?.full_name || 'Unknown',
                    role: caller?.user_type || 'Unknown'
                };
                console.log(`[Socket] Caller info:`, callerInfo);

                // Fetch recipient info (for FCM token)
                const recipient = await User.findById(to);

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
                console.log(`[Socket] Call record created: ${callRecord._id}`);

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

                        console.log(`[Socket] ⏰ Ring timeout for call ${callRecordId} — marking as missed`);

                        await CallHistory.findByIdAndUpdate(callRecordId, {
                            status: 'missed',
                            ended_at: new Date()
                        });

                        // Tell the caller the call was not answered
                        const callerRoom = `user_${callerId}`;
                        io.to(callerRoom).emit('call-declined', { from: receiverId });
                        console.log(`[Socket] ⏰ Emitted call-declined to caller ${callerId}`);

                        // ── Also send a silent FCM to the MODERATOR (caller) as a guaranteed fallback.
                        // Even if the socket.emit above is missed (e.g. brief reconnect), the FCM
                        // wakes up the Flutter foreground handler and stops the ringing.
                        try {
                            const callerUser = await User.findById(callerId).select('fcm_token full_name');
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
                                console.log(`[Socket] ⏰ call_declined FCM sent to moderator ${callerUser.full_name}`);
                            }
                        } catch (fcmCallerErr) {
                            console.error('[Socket] ⏰ Error sending call_declined FCM to caller:', fcmCallerErr);
                        }

                        // Clean up caller socket's currentCallId
                        const callerSockets = await io.in(callerRoom).fetchSockets();
                        for (const s of callerSockets) {
                            delete s.data.currentCallId;
                            delete s.data.callRingTimeout;
                        }

                        // Dismiss the native call screen on receiver's device(s)
                        try {
                            const rcpt = await User.findById(receiverId).select('fcm_token full_name');
                            if (rcpt?.fcm_token) {
                                await sendPushNotification(
                                    [rcpt.fcm_token],
                                    'Call Cancelled',
                                    'Caller ended the call',
                                    { type: 'call_cancel', callerId },
                                    true
                                );
                                console.log(`[Socket] ⏰ call_cancel FCM sent to ${rcpt.full_name}`);
                            }
                        } catch (fcmErr) {
                            console.error('[Socket] ⏰ Error sending timeout call_cancel FCM:', fcmErr);
                        }

                        // Missed-call side effects (DB row already status missed)
                        try {
                            await notifyMissedCallForReceiver(io, getSocketByUserId, {
                                receiverId: String(receiverId),
                                callerId: String(callerId),
                                callId: String(callRecordId),
                            });
                        } catch (notifErr) {
                            console.error('[Socket] ⏰ Error missed-call notify:', notifErr);
                        }
                    } catch (err) {
                        console.error('[Socket] ⏰ Ring timeout handler error:', err);
                    }
                }, 35000); // CallKit client rings ~30s; +5s avoids false "not answered" if clocks skew

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
                                channelName,
                                callRecordId: callRecord._id.toString()
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
                // Do NOT fallback with another emit — it could duplicate the call
                // if the try block partially succeeded.
            }
        });

        // Pilgrim SOS (or any caller): one Agora channel, ring all group moderators in parallel.
        socket.on('call-offer-group', async ({ channelName, targets }) => {
            const { sendPushNotification } = require('../services/pushNotificationService');
            const CallHistory = require('../models/call_history_model');

            if (!channelName || !Array.isArray(targets) || targets.length === 0) {
                console.log('[Socket] call-offer-group ignored — missing channelName or targets');
                return;
            }

            const normTargets = [...new Set(targets.map((t) => String(t)))];
            console.log(`[Socket] Call offer GROUP from ${socket.data.userId} to ${normTargets.length} target(s)`);

            try {
                const caller = await User.findById(socket.data.userId);
                const callerInfo = {
                    id: socket.data.userId,
                    name: caller?.full_name || 'Unknown',
                    role: caller?.user_type || 'Unknown'
                };

                const firstReceiver = normTargets[0];
                const callRecord = await CallHistory.create({
                    caller_id: socket.data.userId,
                    caller_model: 'User',
                    receiver_id: firstReceiver,
                    receiver_model: 'User',
                    call_type: 'internet',
                    status: 'ringing'
                });
                socket.data.currentCallId = callRecord._id;
                socket.data.groupRingTargets = normTargets;
                socket.data.groupRingPendingIds = [...normTargets];

                if (socket.data.callRingTimeout) clearTimeout(socket.data.callRingTimeout);
                const callRecordId = callRecord._id;
                const callerId = socket.data.userId;

                socket.data.callRingTimeout = setTimeout(async () => {
                    try {
                        const record = await CallHistory.findById(callRecordId);
                        if (!record || record.status !== 'ringing') return;

                        console.log(`[Socket] ⏰ Group ring timeout for call ${callRecordId}`);

                        await CallHistory.findByIdAndUpdate(callRecordId, {
                            status: 'missed',
                            ended_at: new Date()
                        });

                        const callerRoom = `user_${callerId}`;
                        io.to(callerRoom).emit('call-declined', { from: firstReceiver });

                        try {
                            const callerUser = await User.findById(callerId).select('fcm_token full_name');
                            if (callerUser?.fcm_token) {
                                await sendPushNotification(
                                    [callerUser.fcm_token],
                                    'Call Not Answered',
                                    'The call was not answered',
                                    {
                                        type: 'call_declined',
                                        callerId: String(firstReceiver),
                                        callRecordId: callRecordId.toString()
                                    },
                                    true
                                );
                            }
                        } catch (fcmCallerErr) {
                            console.error('[Socket] ⏰ group ring FCM to caller:', fcmCallerErr);
                        }

                        const callerSockets = await io.in(callerRoom).fetchSockets();
                        for (const s of callerSockets) {
                            delete s.data.currentCallId;
                            delete s.data.callRingTimeout;
                            delete s.data.groupRingTargets;
                            delete s.data.groupRingPendingIds;
                        }

                        for (const rid of normTargets) {
                            try {
                                const rcpt = await User.findById(rid).select('fcm_token full_name');
                                if (rcpt?.fcm_token) {
                                    await sendPushNotification(
                                        [rcpt.fcm_token],
                                        'Call Cancelled',
                                        'Caller ended the call',
                                        { type: 'call_cancel', callerId: String(callerId) },
                                        true
                                    );
                                }
                            } catch (fcmErr) {
                                console.error('[Socket] ⏰ group timeout call_cancel FCM:', fcmErr);
                            }
                        }
                    } catch (err) {
                        console.error('[Socket] ⏰ Group ring timeout handler error:', err);
                    }
                }, 35000);

                for (const to of normTargets) {
                    const recipient = await User.findById(to);
                    const recipientSockets = await io.in(`user_${to}`).fetchSockets();
                    if (recipientSockets.length > 0) {
                        console.log(`[Socket] Group offer → user_${to} (socket)`);
                        io.to(`user_${to}`).emit('call-offer', {
                            channelName,
                            from: socket.data.userId,
                            callerInfo
                        });
                    } else if (recipient?.fcm_token) {
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
                            true
                        );
                        console.log(`[Socket] Group offer FCM → ${recipient.full_name}`);
                    } else {
                        console.log(`[Socket] Group offer: no socket/FCM for ${to}`);
                    }
                }
            } catch (error) {
                console.error('[Socket] Error in call-offer-group:', error);
            }
        });

        socket.on('group-call-cancel', async () => {
            const { sendPushNotification } = require('../services/pushNotificationService');
            const CallHistory = require('../models/call_history_model');
            const callerId = socket.data.userId;
            if (!callerId) return;

            const callerSock = socket;
            if (!callerSock.data?.groupRingTargets?.length) {
                console.log('[Socket] group-call-cancel ignored — no active group ring');
                return;
            }

            const targets = [...callerSock.data.groupRingTargets];
            if (callerSock.data.callRingTimeout) {
                clearTimeout(callerSock.data.callRingTimeout);
                delete callerSock.data.callRingTimeout;
            }

            try {
                if (callerSock.data.currentCallId) {
                    const rec = await CallHistory.findById(callerSock.data.currentCallId);
                    if (rec?.status === 'ringing') {
                        await CallHistory.findByIdAndUpdate(callerSock.data.currentCallId, {
                            status: 'declined',
                            ended_at: new Date()
                        });
                    }
                    delete callerSock.data.currentCallId;
                }
            } catch (e) {
                console.error('[Socket] group-call-cancel DB:', e);
            }

            delete callerSock.data.groupRingTargets;
            delete callerSock.data.groupRingPendingIds;

            for (const rid of targets) {
                try {
                    io.to(`user_${rid}`).emit('call-cancel', { from: String(callerId) });
                    const u = await User.findById(rid).select('fcm_token');
                    if (u?.fcm_token) {
                        await sendPushNotification(
                            [u.fcm_token],
                            'Call Cancelled',
                            'Caller ended the call',
                            { type: 'call_cancel', callerId: String(callerId) },
                            true
                        );
                    }
                } catch (e) {
                    console.error('[Socket] group-call-cancel notify', rid, e);
                }
            }
            console.log(`[Socket] group-call-cancel completed for caller ${callerId}`);
        });

        socket.on('call-answer', async ({ to }) => {
            console.log(`[Socket] Call answer from ${socket.data.userId} to ${to}`);
            const answererId = String(socket.data.userId);
            const callerSocket = getSocketByUserId(to);
            if (callerSocket?.data?.callRingTimeout) {
                clearTimeout(callerSocket.data.callRingTimeout);
                delete callerSocket.data.callRingTimeout;
            }
            if (callerSocket?.data?.groupRingTargets?.length) {
                const { sendPushNotification } = require('../services/pushNotificationService');
                const gTargets = callerSocket.data.groupRingTargets.map(String);
                for (const tid of gTargets) {
                    if (tid === answererId) continue;
                    io.to(`user_${tid}`).emit('call-cancel', { from: String(to) });
                    try {
                        const u = await User.findById(tid).select('fcm_token full_name');
                        if (u?.fcm_token) {
                            await sendPushNotification(
                                [u.fcm_token],
                                'Call Cancelled',
                                'Another moderator answered',
                                { type: 'call_cancel', callerId: String(to) },
                                true
                            );
                            console.log(`[Socket] ✓ Dismissed ring for mod ${tid} (another answered)`);
                        }
                    } catch (e) {
                        console.error('[Socket] group dismiss FCM:', e);
                    }
                }
                delete callerSocket.data.groupRingTargets;
                delete callerSocket.data.groupRingPendingIds;
            }
            const target = callerSocket || getSocketByUserId(to);
            if (target) {
                console.log(`[Socket] Relaying call-answer to socket ${target.id}`);
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

        socket.on('call-declined', async (payload) => {
            const to = payload?.to;
            const rawNoAnswer = payload?.noAnswer;
            const noAnswer =
                rawNoAnswer === true || rawNoAnswer === 'true' || rawNoAnswer === 1;
            console.log(
                `[Socket] Call declined from ${socket.data.userId} to ${to} (noAnswer=${noAnswer})`
            );
            const callerSock = getSocketByUserId(to);
            const declinerId = String(socket.data.userId);

            if (callerSock?.data?.groupRingPendingIds?.length) {
                const pending = callerSock.data.groupRingPendingIds
                    .map(String)
                    .filter((id) => id !== declinerId);
                callerSock.data.groupRingPendingIds = pending;
                console.log(
                    `[Socket] Group-ring decline from ${declinerId}; ${pending.length} moderator(s) still ringing`
                );
                if (pending.length > 0) {
                    return;
                }
                delete callerSock.data.groupRingPendingIds;
                delete callerSock.data.groupRingTargets;
            }

            if (callerSock?.data?.callRingTimeout) {
                clearTimeout(callerSock.data.callRingTimeout);
                delete callerSock.data.callRingTimeout;
            }
            const callerRoom = `user_${to}`;
            const callerSockets = await io.in(callerRoom).fetchSockets();
            if (callerSockets.length > 0) {
                console.log(`[Socket] Relaying call-declined to ${callerSockets.length} caller socket(s) in ${callerRoom}`);
                io.to(callerRoom).emit('call-declined', { from: socket.data.userId });

                try {
                    const CallHistory = require('../models/call_history_model');
                    const sWithRecord =
                        callerSockets.find((s) => s.data?.currentCallId) || callerSock;
                    let record =
                        sWithRecord?.data?.currentCallId &&
                        (await CallHistory.findById(sWithRecord.data.currentCallId));
                    if (!record) {
                        record = await CallHistory.findOne({
                            caller_id: to,
                            receiver_id: declinerId,
                            status: 'ringing',
                        }).sort({ createdAt: -1 });
                    }
                    if (record && record.status === 'ringing') {
                        const nextStatus = noAnswer ? 'missed' : 'declined';
                        await CallHistory.findByIdAndUpdate(record._id, {
                            status: nextStatus,
                            ended_at: new Date(),
                        });
                        console.log(`[Socket] Call record updated to ${nextStatus}`);
                        for (const s of callerSockets) {
                            if (
                                s.data?.currentCallId &&
                                String(s.data.currentCallId) === String(record._id)
                            ) {
                                delete s.data.currentCallId;
                            }
                        }
                        if (noAnswer && nextStatus === 'missed') {
                            await notifyMissedCallForReceiver(io, getSocketByUserId, {
                                receiverId: String(record.receiver_id),
                                callerId: String(record.caller_id),
                                callId: String(record._id),
                            });
                        }
                    }
                } catch (error) {
                    console.error('[Socket] Error updating call record:', error);
                }
            } else {
                console.log(`[Socket] Caller user ${to} not found for call-declined`);
            }
        });

        socket.on('call-end', async ({ to }) => {
            console.log(`[Socket] Call end from ${socket.data.userId} to ${to}`);
            // Clear ring timeout on both sides
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }
            const target = getSocketByUserId(to);
            if (target?.data?.callRingTimeout) {
                clearTimeout(target.data.callRingTimeout);
                delete target.data.callRingTimeout;
            }
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
                            // Fetch caller name first
                            let callerName = 'Someone';
                            if (socket.data.userId === callRecord.caller_id.toString()) {
                                let me = await User.findById(socket.data.userId).select('full_name');
                                if (!me) me = await Pilgrim.findById(socket.data.userId).select('full_name');
                                callerName = me?.full_name || 'Unknown';
                            }

                            // ── Create a persistent Notification doc for the recipient ──
                            const Notification = require('../models/notification_model');
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
                            console.log(`[Socket] ✓ Missed call notification doc created for ${targetUserId}`);

                            // Emit real-time missed call event so recipient can update their badge
                            const targetSocket = getSocketByUserId(targetUserId);

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
        socket.on('call-cancel', async ({ to }) => {
            console.log(`[Socket] Call cancelled by ${socket.data.userId}, notifying ${to}`);
            // Clear ring timeout — caller cancelled
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }

            // Mark the ringing record as ended (caller hung up before answer).
            // Do NOT use call-end here — that path treats ringing as "missed" and
            // notifies the callee incorrectly.
            try {
                const CallHistory = require('../models/call_history_model');
                if (socket.data.currentCallId) {
                    await CallHistory.findByIdAndUpdate(socket.data.currentCallId, {
                        status: 'declined',
                        ended_at: new Date()
                    });
                    delete socket.data.currentCallId;
                } else {
                    await CallHistory.updateMany(
                        {
                            caller_id: socket.data.userId,
                            receiver_id: to,
                            status: 'ringing'
                        },
                        { status: 'declined', ended_at: new Date() }
                    );
                }
            } catch (err) {
                console.error('[Socket] Error updating call record on call-cancel:', err);
            }

            // Notify every device in the recipient's room (multi-tab / reconnect safe).
            const recipientRoom = `user_${to}`;
            let recipientSockets = [];
            try {
                recipientSockets = await io.in(recipientRoom).fetchSockets();
            } catch (e) {
                console.error('[Socket] fetchSockets for call-cancel failed:', e);
            }

            if (recipientSockets.length > 0) {
                io.to(recipientRoom).emit('call-cancel', { from: socket.data.userId });
                console.log(`[Socket] ✓ call-cancel emitted to ${recipientSockets.length} socket(s) in ${recipientRoom}`);
            }

            // FCM when no socket connected, or as backup when sockets exist but the
            // OS has suspended the Dart VM (still ends native CallKit reliably).
            const shouldFcm = recipientSockets.length === 0;
            if (shouldFcm) {
                try {
                    const { sendPushNotification } = require('../services/pushNotificationService');
                    const recipient = await User.findById(to).select('fcm_token full_name');
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
                        console.log(`[Socket] ✓ call_cancel FCM sent to ${recipient.full_name}`);
                    } else {
                        console.log(`[Socket] Recipient ${to} has no FCM token for call_cancel`);
                    }
                } catch (err) {
                    console.error('[Socket] Error sending call_cancel FCM:', err);
                }
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
        socket.on('sos_cancel', async (data) => {
            const { groupId, pilgrimId } = data;
            if (!groupId) return;
            
            try {
                const Notification = require('../models/notification_model');
                
                // Find the most recent SOS notification for this pilgrim
                const targetPilgrimId = pilgrimId || socket.data.userId;
                const latestSos = await Notification.findOne({
                    type: 'sos_alert',
                    'data.pilgrim_id': targetPilgrimId
                }).sort({ created_at: -1 });

                if (latestSos) {
                    // Delete all SOS notifications generated for this specific SOS trigger event
                    // We use a 5-second window around the latest notification's creation time
                    // because insertMany might create them with milliseconds difference.
                    const timeWindowMs = 5000;
                    const startTime = new Date(latestSos.created_at.getTime() - timeWindowMs);
                    const endTime = new Date(latestSos.created_at.getTime() + timeWindowMs);

                    await Notification.deleteMany({
                        type: 'sos_alert',
                        'data.pilgrim_id': targetPilgrimId,
                        ...(data.sos_id ? { 'data.sos_id': data.sos_id } : { created_at: { $gte: startTime, $lte: endTime } })
                    });
                } else if (data.sos_id) {
                    // Fallback: if latestSos not found but sos_id provided, delete by ID directly
                    await Notification.deleteMany({
                        type: 'sos_alert',
                        'data.sos_id': data.sos_id
                    });
                }
            } catch (err) {
                console.error('[Socket] Failed to delete SOS notifications:', err);
            }

            socket.to(`group_${groupId}`).emit('sos-alert-cancelled', {
                pilgrim_id: pilgrimId || socket.data.userId,
                group_id: groupId,
                timestamp: new Date(),
            });
            console.log(`[Socket] SOS cancelled by ${pilgrimId} in group_${groupId}`);
        });

        // ── Disconnect ────────────────────────────────────────────────────────
        socket.on('disconnect', async (reason) => {
            // Clean up any pending ring timeout
            if (socket.data.callRingTimeout) {
                clearTimeout(socket.data.callRingTimeout);
                delete socket.data.callRingTimeout;
            }
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
                    await User.findByIdAndUpdate(userId, { is_online: false, last_active_at: new Date() });

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
