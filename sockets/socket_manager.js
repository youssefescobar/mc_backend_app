const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');

const initializeSockets = (io) => {
    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.id}`);

        // Join a group room
        socket.on('join_group', (groupId) => {
            if (groupId) {
                socket.join(`group_${groupId}`);
                socket.data.groupId = groupId;
                if (socket.data.userId) {
                    // Notify group that user is active
                    io.to(`group_${groupId}`).emit('status_update', {
                        pilgrimId: socket.data.userId,
                        active: true,
                        last_active_at: new Date()
                    });
                }
                console.log(`[Socket] User ${socket.id} joined group_${groupId}`);
            }
        });

        // Leave a group room
        socket.on('leave_group', (groupId) => {
            if (groupId) {
                socket.leave(`group_${groupId}`);
                // Don't remove groupId from data here, as they might just be switching screens but still connected? 
                // Actually if they leave group explicitly, maybe we shouldn't track them for that group on disconnect.
                // But for now, let's keep it simple.
                console.log(`[Socket] User ${socket.id} left group_${groupId}`);
            }
        });

        // Handle Location Updates
        socket.on('update_location', (data) => {
            // data Expects: { groupId, pilgrimId, lat, lng, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to others in the group (e.g. moderators)
                socket.to(`group_${groupId}`).emit('location_update', data);
                // console.log(`[Socket] Location update from ${data.pilgrimId}`);
            }
        });

        // Handle SOS Alerts
        socket.on('sos_alert', (data) => {
            // data Expects: { groupId, pilgrimId, message, location, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to everyone in group (so moderators see it immediately)
                io.to(`group_${groupId}`).emit('sos_alert', data);
                console.log(`[Socket] SOS Alert from ${data.pilgrimId} in group_${groupId}`);
            }
        });

        // --- WebRTC Signaling for Calls ---
        // Map of userId <-> socketId (for direct signaling)
        socket.on('register-user', async ({ userId, role }) => {
            socket.data.userId = userId;
            socket.data.role = role || 'pilgrim'; // Default to pilgrim if not sent, but better to send it
            console.log(`[Socket] User registered: ${userId} (${socket.data.role}) -> ${socket.id}`);

            // Update active status to TRUE
            try {
                if (socket.data.role === 'pilgrim') {
                    await Pilgrim.findByIdAndUpdate(userId, { active: true, last_active_at: new Date() });
                } else {
                    await User.findByIdAndUpdate(userId, { active: true, last_active_at: new Date() });
                }
            } catch (err) {
                console.error('[Socket] Error updating active status (connect):', err);
            }
        });

        // Helper to find socket by userId
        function getSocketByUserId(userId) {
            return Array.from(io.sockets.sockets.values()).find(s => s.data.userId === userId);
        }

        socket.on('call-offer', async ({ to, offer }) => {
            // ... existing call logic ...
            // (I will skip replacing the entire call logic block to avoid huge output, just target the parts I need)
            // Wait, I can't skip parts in replace_file_content if I want to match a contiguous block. 
            // I selected a huge block in my thought process but I should be careful. 
            // Let's just update the specific blocks.
        });

        // Leave a group room
        // Join a group room
        socket.on('join_group', (groupId) => {
            if (groupId) {
                socket.join(`group_${groupId}`);
                socket.data.groupId = groupId;
                if (socket.data.userId) {
                    // Notify group that user is active
                    io.to(`group_${groupId}`).emit('status_update', {
                        pilgrimId: socket.data.userId,
                        active: true,
                        last_active_at: new Date()
                    });
                }
                console.log(`[Socket] User ${socket.id} joined group_${groupId}`);
            }
        });

        // Handle Location Updates
        socket.on('update_location', (data) => {
            // data Expects: { groupId, pilgrimId, lat, lng, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to others in the group (e.g. moderators)
                socket.to(`group_${groupId}`).emit('location_update', data);
                // console.log(`[Socket] Location update from ${data.pilgrimId}`);
            }
        });

        // Handle SOS Alerts
        socket.on('sos_alert', (data) => {
            // data Expects: { groupId, pilgrimId, message, location, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to everyone in group (so moderators see it immediately)
                io.to(`group_${groupId}`).emit('sos_alert', data);
                console.log(`[Socket] SOS Alert from ${data.pilgrimId} in group_${groupId}`);
            }
        });

        // Map of userId <-> socketId (for direct signaling)
        socket.on('register-user', async ({ userId, role }) => {
            socket.data.userId = userId;
            socket.data.role = role || 'pilgrim'; // Default to pilgrim if not sent, but better to send it
            console.log(`[Socket] User registered: ${userId} (${socket.data.role}) -> ${socket.id}`);

            // Update active status to TRUE
            try {
                if (socket.data.role === 'pilgrim') {
                    await Pilgrim.findByIdAndUpdate(userId, { is_online: true, last_active_at: new Date() });
                } else {
                    await User.findByIdAndUpdate(userId, { is_online: true, last_active_at: new Date() });
                }
            } catch (err) {
                console.error('[Socket] Error updating active status (connect):', err);
            }
        });

        // Helper to find socket by userId
        function getSocketByUserId(userId) {
            return Array.from(io.sockets.sockets.values()).find(s => s.data.userId === userId);
        }

        socket.on('call-offer', async ({ to, offer }) => {
            console.log(`[Socket] Call offer from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            console.log(`[Socket] Target socket found: ${target ? 'YES (socket id: ' + target.id + ')' : 'NO (will send push notification)'}`);

            // Fetch caller information from database and create call record
            try {
                const User = require('../models/user_model');
                const Pilgrim = require('../models/pilgrim_model');
                const CallHistory = require('../models/call_history_model');
                const { sendPushNotification } = require('../services/pushNotificationService');

                console.log(`[Socket] Fetching caller info for userId: ${socket.data.userId}`);

                // Try to find in User model first (moderators)
                let caller = await User.findById(socket.data.userId).select('full_name role');

                // If not found, try Pilgrim model
                if (!caller) {
                    caller = await Pilgrim.findById(socket.data.userId).select('full_name role');
                }

                console.log(`[Socket] Caller found:`, caller);

                const callerInfo = {
                    id: socket.data.userId,
                    name: caller?.full_name || 'Unknown',
                    role: caller?.role || 'Unknown'
                };

                // Always fetch recipient for potential push notification
                let recipient = await User.findById(to).select('fcm_token full_name role');
                if (!recipient) {
                    recipient = await Pilgrim.findById(to).select('fcm_token full_name role');
                }

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
                console.log(`[Socket] Call record created: ${callRecord._id}`);
                // Store call record ID in socket data for later updates
                socket.data.currentCallId = callRecord._id;

                if (target) {
                    // Recipient is online - send via socket
                    console.log(`[Socket] Sending call-offer via socket to ${to}`);
                    target.emit('call-offer', { offer, from: socket.data.userId, callerInfo });

                    // ALSO send push notification for reliability (app might be backgrounded)
                    if (recipient?.fcm_token) {
                        console.log(`[Socket] Also sending push notification (app might be backgrounded)...`);
                        await sendPushNotification(
                            [recipient.fcm_token],
                            'Incoming Call',
                            `${callerInfo.name} is calling you`,
                            {
                                type: 'incoming_call',
                                callerId: socket.data.userId,
                                callerName: callerInfo.name,
                                callerRole: callerInfo.role,
                                offer: JSON.stringify(offer)
                            },
                            true // isUrgent - use high priority
                        );
                        console.log(`[Socket] ✓ Push notification sent as backup`);
                    }
                } else {
                    console.log(`[Socket] Recipient ${to} is offline, sending push notification`);

                    console.log(`[Socket] Recipient found: ${recipient?.full_name}, FCM token: ${recipient?.fcm_token ? 'EXISTS' : 'MISSING'}`);

                    if (recipient?.fcm_token) {
                        console.log(`[Socket] Sending push notification to ${recipient.full_name}...`);
                        await sendPushNotification(
                            [recipient.fcm_token],
                            'Incoming Call',
                            `${callerInfo.name} is calling you`,
                            {
                                type: 'incoming_call',
                                callerId: socket.data.userId,
                                callerName: callerInfo.name,
                                callerRole: callerInfo.role,
                                offer: JSON.stringify(offer)
                            },
                            true // isUrgent - use high priority
                        );
                        console.log(`[Socket] ✓ Push notification sent successfully to ${recipient.full_name}`);
                    } else {
                        console.log(`[Socket] ✗ No FCM token found for recipient ${to}`);
                    }
                }
            } catch (error) {
                console.error('[Socket] Error fetching caller info:', error);
                if (target) {
                    target.emit('call-offer', { offer, from: socket.data.userId });
                }
            }
        });
        socket.on('call-answer', async ({ to, answer }) => {
            console.log(`[Socket] Call answer from ${socket.data.userId} to ${to}`);
            const target = getSocketByUserId(to);
            if (target) {
                target.emit('call-answer', { answer, from: socket.data.userId });

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

                // Update call record to declined
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

            // Update call record to completed
            try {
                const CallHistory = require('../models/call_history_model');
                const { sendPushNotification } = require('../services/pushNotificationService');
                const User = require('../models/user_model');
                const Pilgrim = require('../models/pilgrim_model');

                if (socket.data.currentCallId) {
                    const callRecord = await CallHistory.findById(socket.data.currentCallId);
                    if (callRecord) {
                        const isMissed = callRecord.status === 'ringing';
                        const duration = callRecord.started_at
                            ? Math.floor((new Date() - callRecord.started_at) / 1000)
                            : 0;

                        // Identify the OTHER person (the one who missed the call)
                        // If I am caller, other is receiver. If I am receiver (unlikely for call-end), other is caller.
                        // Usually call-end comes from caller hanging up.
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
                            // Send Missed Call Notification
                            console.log(`[Socket] Sending missed call notification to ${targetUserId}`);
                            let targetUser = await User.findById(targetUserId).select('fcm_token full_name');
                            if (!targetUser) {
                                targetUser = await Pilgrim.findById(targetUserId).select('fcm_token full_name');
                            }

                            if (targetUser?.fcm_token) {
                                // Get caller name
                                let callerName = 'Someone';
                                if (socket.data.userId === callRecord.caller_id.toString()) {
                                    // I am caller
                                    let me = await User.findById(socket.data.userId).select('full_name');
                                    if (!me) me = await Pilgrim.findById(socket.data.userId).select('full_name');
                                    callerName = me?.full_name || 'Unknown';
                                }

                                await sendPushNotification(
                                    [targetUser.fcm_token],
                                    'Missed Call',
                                    `You missed a call from ${callerName}`,
                                    {
                                        type: 'missed_call',
                                        callId: callRecord._id.toString(),
                                        callerId: socket.data.userId,
                                        callerName: callerName
                                    }
                                );
                                console.log(`[Socket] ✓ Missed call notification sent to ${targetUser.full_name}`);
                            }
                        }

                        delete socket.data.currentCallId;
                    }
                }
            } catch (error) {
                console.error('[Socket] Error updating call record:', error);
            }
        });



        socket.on('disconnect', async (reason) => {
            const { userId, role, groupId } = socket.data;
            console.log(`[Socket] User disconnected: ${socket.id} (Reason: ${reason})`);
            console.log(`[Socket] Debug Data - User: ${userId}, Role: ${role}, Group: ${groupId}`);

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
                    console.error('[Socket] Error updating active status (disconnect):', err);
                }
            }
        });
    });
};

module.exports = { initializeSockets };
