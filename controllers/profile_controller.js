const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');
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
        if (req.user.role === 'pilgrim') {
            const [pilgrim, latest_request] = await Promise.all([
                Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at language'),
                ModeratorRequest.findOne({ pilgrim_id: req.user.id }).sort({ requested_at: -1 }).select('status')
            ]);

            if (!pilgrim) {
                return sendError(res, 404, 'Profile not found');
            }

            const moderator_request_status = latest_request?.status || null;

            return res.json({
                ...pilgrim.toObject(),
                moderator_request_status,
                pending_moderator_request: moderator_request_status === 'pending'
            });
        } else {
            const user = await User.findById(req.user.id).select('_id full_name email role phone_number created_at');

            if (user) {
                return res.json(user);
            }

            // Fallback: approved moderators may still exist in Pilgrim collection
            const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at language');
            
            if (!pilgrim) {
                return sendError(res, 404, 'Profile not found');
            }

            const pending_request = await ModeratorRequest.exists({
                pilgrim_id: req.user.id,
                status: 'pending'
            });

            return res.json({
                ...pilgrim.toObject(),
                moderator_request_status: null,
                pending_moderator_request: Boolean(pending_request)
            });
        }
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

        if (req.user.role === 'pilgrim') {
            const updateData = {
                ...(full_name && { full_name }),
                ...(phone_number && { phone_number }),
                ...(age !== undefined && { age: parseInt(age) }),
                ...(gender && { gender }),
                ...(medical_history !== undefined && { medical_history }),
                ...(language && { language })
            };

            const updatedPilgrim = await Pilgrim.findByIdAndUpdate(
                req.user.id,
                updateData,
                { new: true }
            ).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at language');

            if (!updatedPilgrim) {
                return sendError(res, 404, 'Profile not found');
            }

            logger.info(`Pilgrim profile updated: ${req.user.id}`);
            return res.json({ message: "Profile updated successfully", user: updatedPilgrim });
        } else {
            const updateData = {
                ...(full_name && { full_name }),
                ...(phone_number && { phone_number })
            };

            const updatedUser = await User.findByIdAndUpdate(
                req.user.id,
                updateData,
                { new: true }
            ).select('_id full_name email role phone_number created_at');

            if (!updatedUser) {
                return sendError(res, 404, 'Profile not found');
            }

            logger.info(`User profile updated: ${req.user.id}`);
            return res.json({ message: "Profile updated successfully", user: updatedUser });
        }
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

        if (req.user.role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(req.user.id, { language }, { new: true });
        } else {
            await User.findByIdAndUpdate(req.user.id, { language }, { new: true });
        }

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
        const { latitude, longitude } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return sendError(res, 400, 'Latitude and longitude required');
        }

        if (req.user.role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(req.user.id, {
                current_latitude: latitude,
                current_longitude: longitude,
                last_location_update: new Date()
            });
        } else {
            await User.findByIdAndUpdate(req.user.id, {
                current_latitude: latitude,
                current_longitude: longitude,
                last_location_update: new Date()
            });
        }

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

        if (req.user.role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(req.user.id, { fcm_token });
        } else {
            await User.findByIdAndUpdate(req.user.id, { fcm_token });
        }

        sendSuccess(res, 200, 'FCM Token updated');
    } catch (error) {
        sendServerError(res, logger, 'Update FCM token error', error);
    }
};

/**
 * Add or update email for pilgrim
 */
exports.add_email = async (req, res) => {
    try {
        const { email } = req.body;
        const pilgrim_id = req.user.id;

        // Check if email is already in use
        const [existing_pilgrim, existing_user] = await Promise.all([
            Pilgrim.findOne({ email, _id: { $ne: pilgrim_id } }),
            User.findOne({ email })
        ]);

        if (existing_pilgrim || existing_user) {
            return sendValidationError(res, { 
                email: 'This email is already registered with another account' 
            });
        }

        // Update pilgrim email and set verified to false
        await Pilgrim.findByIdAndUpdate(pilgrim_id, {
            email,
            email_verified: false
        });

        logger.info(`Pilgrim added email: ${email} (${pilgrim_id})`);
        sendSuccess(res, 200, 'Email added successfully. Please verify your email.');
    } catch (error) {
        sendServerError(res, logger, 'Add email error', error);
    }
};

/**
 * Send email verification code to pilgrim
 */
exports.send_email_verification = async (req, res) => {
    try {
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        if (!pilgrim.email) {
            return sendError(res, 400, 'No email address on file. Please add an email first.');
        }

        if (pilgrim.email_verified) {
            return sendError(res, 400, 'Email is already verified');
        }

        // Generate verification code
        const verification_code = generateVerificationCode();

        // Store code in PendingUser temporarily
        await PendingUser.findOneAndUpdate(
            { email: pilgrim.email },
            {
                email: pilgrim.email,
                verification_code,
                full_name: pilgrim.full_name,
                password: pilgrim.password,
                phone_number: pilgrim.phone_number
            },
            { upsert: true }
        );

        // Send verification email asynchronously
        sendVerificationEmail(pilgrim.email, verification_code, pilgrim.full_name)
            .then(() => logger.info(`Verification email sent to ${pilgrim.email}`))
            .catch(err => logger.error(`Failed to send verification email: ${err.message}`));

        sendSuccess(res, 200, 'Verification code sent to your email');
    } catch (error) {
        sendServerError(res, logger, 'Send verification error', error);
    }
};

/**
 * Verify pilgrim email with code
 */
exports.verify_pilgrim_email = async (req, res) => {
    try {
        const { code } = req.body;
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        if (!pilgrim.email) {
            return sendError(res, 400, 'No email address on file');
        }

        // Check verification code
        const pending = await PendingUser.findOne({ email: pilgrim.email });
        if (!pending) {
            return sendError(res, 400, 'No verification code found. Please request a new one.');
        }

        if (pending.verification_code !== code) {
            return sendError(res, 400, 'Invalid verification code');
        }

        // Mark email as verified
        await Pilgrim.findByIdAndUpdate(pilgrim_id, { email_verified: true });

        // Clean up pending record
        await PendingUser.deleteOne({ email: pilgrim.email });

        logger.info(`Pilgrim email verified: ${pilgrim.email} (${pilgrim_id})`);
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
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        // Check if email exists
        if (!pilgrim.email) {
            return sendValidationError(res, { 
                email: 'You must add an email address before requesting moderator status' 
            });
        }

        // Check if email is verified
        if (!pilgrim.email_verified) {
            return sendValidationError(res, { 
                email: 'You must verify your email address before requesting moderator status' 
            });
        }

        // Check if already a moderator
        if (pilgrim.role === 'moderator') {
            return sendError(res, 400, 'You are already a moderator');
        }

        // Check if there's already a pending request
        const existing_request = await ModeratorRequest.findOne({
            pilgrim_id,
            status: 'pending'
        });

        if (existing_request) {
            return sendError(res, 400, 'You already have a pending moderator request');
        }

        // Create moderator request
        await ModeratorRequest.create({ pilgrim_id });

        logger.info(`Moderator request submitted: ${pilgrim_id}`);
        sendSuccess(res, 200, 'Moderator request submitted successfully. An admin will review your request.');
    } catch (error) {
        sendServerError(res, logger, 'Request moderator error', error);
    }
};
