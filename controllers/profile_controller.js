const User = require('../models/user_model');
const Group = require('../models/group_model');
const PendingUser = require('../models/pending_user_model');
const ModeratorRequest = require('../models/moderator_request_model');
const { logger } = require('../config/logger');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');
const { sendSuccess, sendError, sendValidationError, sendServerError } = require('../utils/response_helpers');

/**
 * Get current user profile
 */
exports.get_profile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified user_type created_at language');
        
        if (!user) {
            return sendError(res, 404, 'Profile not found');
        }

        // For pilgrims, include moderator request status
        if (user.user_type === 'pilgrim') {
            const latest_request = await ModeratorRequest.findOne({ pilgrim_id: req.user.id }).sort({ requested_at: -1 }).select('status');
            const moderator_request_status = latest_request?.status || null;

            return res.json({
                ...user.toObject(),
                role: user.user_type, // Backward compatibility
                moderator_request_status,
                pending_moderator_request: moderator_request_status === 'pending'
            });
        }

        // For moderators/admins
        return res.json({
            ...user.toObject(),
            role: user.user_type // Backward compatibility
        });
    } catch (error) {
        sendServerError(res, logger, 'Get profile error', error);
    }
};

/**
 * Update user profile
 */
exports.update_profile = async (req, res) => {
    try {
        const { full_name, phone_number, age, gender, medical_history, language } = req.body;

        const updateData = {
            ...(full_name && { full_name }),
            ...(phone_number && { phone_number }),
            ...(age !== undefined && { age: parseInt(age) }),
            ...(gender && { gender }),
            ...(medical_history !== undefined && { medical_history }),
            ...(language && { language })
        };

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            return sendError(res, 404, 'Profile not found');
        }

        logger.info(`User profile updated: ${req.user.id}`);
        sendSuccess(res, 200, 'Profile updated successfully', { user: updatedUser });
    } catch (error) {
        sendServerError(res, logger, 'Update profile error', error);
    }
};

/**
 * Update language preference
 */
exports.update_language = async (req, res) => {
    try {
        const { language } = req.body;

        await User.findByIdAndUpdate(req.user.id, { language }, { new: true, runValidators: true });

        logger.info(`User ${req.user.id} updated language to ${language}`);
        sendSuccess(res, 200, 'Language updated successfully');
    } catch (error) {
        sendServerError(res, logger, 'Update language error', error);
    }
};

/**
 * Update user location (GPS coordinates)
 */
exports.update_location = async (req, res) => {
    try {
        const { latitude, longitude, battery } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return sendError(res, 400, 'Latitude and longitude required');
        }

        const updateData = {
            current_latitude: latitude,
            current_longitude: longitude,
            last_location_update: new Date()
        };

        if (battery !== undefined) {
            updateData.battery_percent = battery;
        }

        await User.findByIdAndUpdate(req.user.id, updateData);

        sendSuccess(res, 200, 'Location updated');
    } catch (error) {
        sendServerError(res, logger, 'Update location error', error);
    }
};

/**
 * Update FCM token for push notifications
 */
exports.update_fcm_token = async (req, res) => {
    try {
        const { fcm_token } = req.body;

        if (!fcm_token) {
            return sendError(res, 400, 'FCM Token is required');
        }

        await User.findByIdAndUpdate(req.user.id, { fcm_token });

        sendSuccess(res, 200, 'FCM Token updated');
    } catch (error) {
        sendServerError(res, logger, 'Update FCM token error', error);
    }
};

/**
 * Add or update email for user
 */
exports.add_email = async (req, res) => {
    try {
        const { email } = req.body;
        const user_id = req.user.id;

        // Check if email is already in use
        const existing_user = await User.findOne({ email, _id: { $ne: user_id } });

        if (existing_user) {
            return sendValidationError(res, { 
                email: 'This email is already registered with another account' 
            });
        }

        // Update user email and set verified to false
        await User.findByIdAndUpdate(user_id, {
            email,
            email_verified: false
        });

        logger.info(`User added email: ${email} (${user_id})`);
        sendSuccess(res, 200, 'Email added successfully. Please verify your email.');
    } catch (error) {
        sendServerError(res, logger, 'Add email error', error);
    }
};

/**
 * Send email verification code
 */
exports.send_email_verification = async (req, res) => {
    try {
        const user_id = req.user.id;

        const user = await User.findById(user_id);
        if (!user) {
            return sendError(res, 404, 'User not found');
        }

        if (!user.email) {
            return sendError(res, 400, 'No email address on file. Please add an email first.');
        }

        if (user.email_verified) {
            return sendError(res, 400, 'Email is already verified');
        }

        // Generate verification code
        const verification_code = generateVerificationCode();

        // Store code in PendingUser temporarily
        await PendingUser.findOneAndUpdate(
            { email: user.email },
            {
                email: user.email,
                verification_code,
                full_name: user.full_name,
                password: user.password,
                phone_number: user.phone_number
            },
            { upsert: true }
        );

        // Send verification email asynchronously
        sendVerificationEmail(user.email, verification_code, user.full_name)
            .then(() => logger.info(`Verification email sent to ${user.email}`))
            .catch(err => logger.error(`Failed to send verification email: ${err.message}`));

        sendSuccess(res, 200, 'Verification code sent to your email');
    } catch (error) {
        sendServerError(res, logger, 'Send verification error', error);
    }
};

/**
 * Verify user email with code
 */
exports.verify_pilgrim_email = async (req, res) => {
    try {
        const { code } = req.body;
        const user_id = req.user.id;

        const user = await User.findById(user_id);
        if (!user) {
            return sendError(res, 404, 'User not found');
        }

        if (!user.email) {
            return sendError(res, 400, 'No email address on file');
        }

        // Check verification code
        const pending = await PendingUser.findOne({ email: user.email });
        if (!pending) {
            return sendError(res, 400, 'No verification code found. Please request a new one.');
        }

        if (pending.verification_code !== code) {
            return sendError(res, 400, 'Invalid verification code');
        }

        // Mark email as verified
        await User.findByIdAndUpdate(user_id, { email_verified: true });

        // Clean up pending record
        await PendingUser.deleteOne({ email: user.email });

        logger.info(`User email verified: ${user.email} (${user_id})`);
        sendSuccess(res, 200, 'Email verified successfully');
    } catch (error) {
        sendServerError(res, logger, 'Verify email error', error);
    }
};

/**
 * Request moderator status (requires verified email)
 */
exports.request_moderator = async (req, res) => {
    try {
        const user_id = req.user.id;

        const user = await User.findById(user_id);
        if (!user) {
            return sendError(res, 404, 'User not found');
        }

        // Check if user is a pilgrim
        if (user.user_type !== 'pilgrim') {
            return sendError(res, 400, 'Only pilgrims can request moderator status');
        }

        // Check if email exists
        if (!user.email) {
            return sendValidationError(res, { 
                email: 'You must add an email address before requesting moderator status' 
            });
        }

        // Check if email is verified
        if (!user.email_verified) {
            return sendValidationError(res, { 
                email: 'You must verify your email address before requesting moderator status' 
            });
        }

        // Check if there's already a pending request
        const existing_request = await ModeratorRequest.findOne({
            pilgrim_id: user_id,
            status: 'pending'
        });

        if (existing_request) {
            return sendError(res, 400, 'You already have a pending moderator request');
        }

        // Create moderator request
        await ModeratorRequest.create({ pilgrim_id: user_id });

        logger.info(`Moderator request submitted: ${user_id}`);
        sendSuccess(res, 200, 'Moderator request submitted successfully. An admin will review your request.');
    } catch (error) {
        sendServerError(res, logger, 'Request moderator error', error);
    }
};

/**
 * Get pilgrim's assigned group
 */
exports.get_my_group = async (req, res) => {
    try {
        // Find group that contains this user (pilgrim)
        const group = await Group.findOne({ pilgrim_ids: req.user.id })
            .populate('created_by', 'full_name email phone_number current_latitude current_longitude')
            .populate('moderator_ids', 'full_name email phone_number current_latitude current_longitude');

        if (!group) {
            return sendError(res, 404, 'You are not assigned to any group');
        }

        sendSuccess(res, 200, null, {
            group_name: group.group_name,
            group_id: group._id,
            created_by: group.created_by,
            moderators: group.moderator_ids,
            pilgrim_count: group.pilgrim_ids?.length || 0,
            allow_pilgrim_navigation: group.allow_pilgrim_navigation || false
        });
    } catch (error) {
        sendServerError(res, logger, 'Get my group error', error);
    }
};

/**
 * Trigger SOS emergency alert
 */
exports.trigger_sos = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return sendError(res, 404, 'User not found');
        }

        // Find the group this user belongs to
        const group = await Group.findOne({ pilgrim_ids: req.user.id })
            .populate('moderator_ids', '_id full_name fcm_token');

        if (!group) {
            return sendError(res, 404, 'Not assigned to any group');
        }

        // Create notifications for all moderators in the group
        const moderatorIdsSet = new Set(
            [group.created_by?.toString(), ...group.moderator_ids.map(m => m._id?.toString())]
                .filter(Boolean)
        );
        const moderatorIds = Array.from(moderatorIdsSet);

        const notifications = moderatorIds.map(modId => ({
            user_id: modId,
            type: 'sos_alert',
            title: 'Lost Pilgrim Alert',
            message: `${user.full_name} reported they are lost and needs help.`,
            data: {
                pilgrim_id: user._id,
                pilgrim_name: user.full_name,
                pilgrim_phone: user.phone_number,
                location: {
                    lat: user.current_latitude,
                    lng: user.current_longitude
                },
                group_id: group._id,
                group_name: group.group_name
            }
        }));

        await Notification.insertMany(notifications);

        // Emit real-time SOS alert via Socket.io to group
        const io = req.app.get('socketio');
        if (io) {
            io.to(`group_${group._id}`).emit('sos-alert-received', {
                pilgrim_id: user._id,
                pilgrim_name: user.full_name,
                pilgrim_phone: user.phone_number,
                location: {
                    lat: user.current_latitude,
                    lng: user.current_longitude
                },
                group_id: group._id,
                group_name: group.group_name,
                timestamp: new Date()
            });
            console.log(`[API] SOS alert emitted to group ${group._id}`);
        }

        // Send push notifications to all moderators
        const { sendPushNotification } = require('../services/pushNotificationService');
        const moderatorTokens = group.moderator_ids
            .filter(m => m.fcm_token)
            .map(m => m.fcm_token);

        if (group.created_by?.fcm_token && !moderatorTokens.includes(group.created_by.fcm_token)) {
            moderatorTokens.push(group.created_by.fcm_token);
        }

        if (moderatorTokens.length > 0) {
            await sendPushNotification(
                moderatorTokens,
                '🚨 SOS ALERT',
                `${user.full_name} needs immediate help in ${group.group_name}`,
                {
                    type: 'sos_alert',
                    pilgrim_id: user._id.toString(),
                    pilgrim_name: user.full_name,
                    pilgrim_phone: user.phone_number,
                    lat: (user.current_latitude || 0).toString(),
                    lng: (user.current_longitude || 0).toString(),
                    group_id: group._id.toString(),
                    group_name: group.group_name
                },
                true // is_urgent
            );
            console.log(`[API] SOS push notifications sent to ${moderatorTokens.length} moderators`);
        }

        logger.warn(`SOS Alert triggered by ${user.full_name} (${user._id}) in group ${group.group_name}`);

        sendSuccess(res, 200, 'SOS alert sent to moderators', {
            notified_count: moderatorIds.length
        });
    } catch (error) {
        sendServerError(res, logger, 'SOS trigger error', error);
    }
};
