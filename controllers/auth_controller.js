const User = require('../models/user_model');
const PendingUser = require('../models/pending_user_model');
const Pilgrim = require('../models/pilgrim_model');
const Group = require('../models/group_model');
const PendingPilgrim = require('../models/pending_pilgrim_model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');
const { logger } = require('../config/logger');
const { sendSuccess, sendError, sendValidationError, sendServerError, JWT_EXPIRATION } = require('../utils/response_helpers');

/**
 * Register a new pilgrim account (public signup)
 */
exports.register_user = async (req, res) => {
    try {
        const { full_name, national_id, phone_number, password, email, medical_history, age, gender, language } = req.body;

        // Check for existing user with same credentials
        const existing_pilgrim = await Pilgrim.findOne({
            $or: [
                { national_id },
                { phone_number },
                ...(email && email.trim() ? [{ email: email.trim() }] : [])
            ]
        });

        if (existing_pilgrim) {
            if (existing_pilgrim.national_id === national_id) {
                return sendValidationError(res, { national_id: 'National ID is already registered' });
            }
            if (existing_pilgrim.phone_number === phone_number) {
                return sendValidationError(res, { phone_number: 'Phone number is already registered' });
            }
            if (email && existing_pilgrim.email === email.trim()) {
                return sendValidationError(res, { email: 'Email is already registered' });
            }
        }

        const hashed_password = await bcrypt.hash(password, 10);

        // Create Pilgrim account
        const pilgrim = await Pilgrim.create({
            full_name,
            national_id,
            phone_number,
            password: hashed_password,
            email: email && email.trim() ? email.trim() : undefined,
            medical_history,
            age,
            gender,
            language: language || 'en',
            role: 'pilgrim'
        });

        // Generate JWT token
        const token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        logger.info(`Pilgrim registered: ${pilgrim.full_name} (${pilgrim._id})`);

        sendSuccess(res, 201, 'Pilgrim account created successfully', {
            token,
            role: 'pilgrim',
            user_id: pilgrim._id,
            full_name: pilgrim.full_name
        });
    } catch (error) {
        sendServerError(res, logger, 'Registration error', error);
    }
};

/**
 * Verify moderator email with OTP code (for moderator registration flow)
 */
exports.verify_email = async (req, res) => {
    try {
        const { email, code } = req.body;

        const pending_user = await PendingUser.findOne({ email });

        if (!pending_user) {
            return sendError(res, 400, 'No pending registration found. Please register again.');
        }

        if (pending_user.verification_code !== code) {
            return sendError(res, 400, 'Invalid verification code');
        }

        // Create the actual user
        const user = await User.create({
            full_name: pending_user.full_name,
            email: pending_user.email,
            password: pending_user.password,
            role: 'moderator',
            phone_number: pending_user.phone_number
        });

        // Delete pending user
        await PendingUser.deleteOne({ email });

        logger.info(`Email verified and Moderator created: ${user.email} (${user._id})`);

        sendSuccess(res, 201, 'Email verified successfully. You can now login.', { user_id: user._id });
    } catch (error) {
        sendServerError(res, logger, 'Verification error', error);
    }
};

/**
 * Resend verification code
 */
exports.resend_verification = async (req, res) => {
    try {
        const { email } = req.body;

        const pending_user = await PendingUser.findOne({ email });

        if (!pending_user) {
            return sendError(res, 400, 'No pending registration found. Please register again.');
        }

        // Generate new code
        const verification_code = generateVerificationCode();

        // Update pending user with new code and reset expiry
        pending_user.verification_code = verification_code;
        pending_user.created_at = new Date();
        await pending_user.save();

        // Send new verification email asynchronously
        sendVerificationEmail(email, verification_code, pending_user.full_name)
            .then(() => logger.info(`Verification email resent to ${email}`))
            .catch(err => logger.error(`Failed to resend verification email to ${email}: ${err.message}`));

        sendSuccess(res, 200, 'Verification code resent to email');
    } catch (error) {
        sendServerError(res, logger, 'Resend verification error', error);
    }
};

/**
 * Login user (pilgrim, moderator, or admin)
 */
exports.login_user = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        // Try to find user in Pilgrim and User collections in parallel
        const [pilgrim, adminUser] = await Promise.all([
            Pilgrim.findOne({
                $or: [
                    { email: identifier },
                    { national_id: identifier },
                    { phone_number: identifier }
                ]
            }),
            User.findOne({
                $or: [
                    { email: identifier },
                    { phone_number: identifier }
                ]
            })
        ]);

        let user = pilgrim || adminUser;

        if (!user) {
            return sendError(res, 401, 'Invalid credentials');
        }

        // Check if account is active
        if (user.active === false) {
            return sendError(res, 403, 'Account is deactivated');
        }

        // Verify password
        const is_match = await bcrypt.compare(password, user.password);
        if (!is_match) {
            return sendError(res, 401, 'Invalid credentials');
        }

        // Generate token
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        logger.info(`User logged in: ${user._id} (${user.role})`);

        res.json({
            token,
            role: user.role,
            user_id: user._id,
            full_name: user.full_name,
            language: user.language || 'en'
        });
    } catch (error) {
        sendServerError(res, logger, 'Login error', error);
    }
};

/**
 * Logout user (clear FCM token)
 */
exports.logout_user = async (req, res) => {
    try {
        const user_id = req.user.id;
        const role = req.user.role;

        if (role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(user_id, { fcm_token: null });
        } else {
            await User.findByIdAndUpdate(user_id, { fcm_token: null });
        }

        logger.info(`User logged out: ${user_id}`);
        sendSuccess(res, 200, 'Logged out successfully');
    } catch (error) {
        sendServerError(res, logger, 'Logout error', error);
    }
};

/**
 * Register a new pilgrim via invitation link
 */
exports.register_invited_pilgrim = async (req, res) => {
    try {
        const { full_name, password, token } = req.body;

        // Validate Token
        const pending_pilgrim = await PendingPilgrim.findOne({ verification_token: token });

        if (!pending_pilgrim) {
            return sendError(res, 400, 'Invalid or expired invitation token');
        }

        if (new Date() > pending_pilgrim.expires_at) {
            return sendError(res, 400, 'Invitation has expired');
        }

        // Check if email already registered
        const [existing_user, existing_pilgrim] = await Promise.all([
            User.findOne({ email: pending_pilgrim.email }),
            Pilgrim.findOne({ email: pending_pilgrim.email })
        ]);

        if (existing_user || existing_pilgrim) {
            return sendError(res, 400, 'Email is already registered. Please login.');
        }

        // Create Pilgrim Account
        const hashed_password = await bcrypt.hash(password, 10);

        const pilgrim = await Pilgrim.create({
            full_name,
            email: pending_pilgrim.email,
            password: hashed_password,
            created_by: pending_pilgrim.invited_by
        });

        // Add Pilgrim to Group
        await Group.findByIdAndUpdate(pending_pilgrim.group_id, {
            $addToSet: { pilgrim_ids: pilgrim._id }
        });

        // Delete Pending Record
        await PendingPilgrim.deleteOne({ _id: pending_pilgrim._id });

        // Generate Login Token
        const jwt_token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        logger.info(`Invited pilgrim registered: ${pilgrim.full_name} (${pilgrim._id})`);

        sendSuccess(res, 201, 'Pilgrim account registered and added to group', {
            token: jwt_token,
            role: 'pilgrim',
            full_name: pilgrim.full_name,
            user_id: pilgrim._id
        });
    } catch (error) {
        sendServerError(res, logger, 'Pilgrim invitation registration error', error);
    }
};

/**
 * Register a pilgrim (by moderator/admin)
 */
exports.register_pilgrim = async (req, res) => {
    try {
        const { full_name, national_id, medical_history, email, age, gender, phone_number, password } = req.body;

        // Check if pilgrim already exists
        const existing_pilgrim = await Pilgrim.findOne({
            $or: [
                { national_id },
                ...(phone_number ? [{ phone_number }] : [])
            ]
        });

        if (existing_pilgrim) {
            if (existing_pilgrim.national_id === national_id) {
                return sendValidationError(res, { national_id: 'Pilgrim with this ID already exists' });
            }
            if (phone_number && existing_pilgrim.phone_number === phone_number) {
                return sendValidationError(res, { phone_number: 'Phone number already registered' });
            }
        }

        // Hash password if provided
        let hashed_password = undefined;
        if (password) {
            hashed_password = await bcrypt.hash(password, 10);
        }

        const pilgrim = await Pilgrim.create({
            full_name,
            national_id,
            medical_history,
            email,
            phone_number,
            age,
            gender,
            password: hashed_password,
            created_by: req.user.id
        });

        logger.info(`Pilgrim manually registered by moderator: ${pilgrim._id}`);

        sendSuccess(res, 201, 'Pilgrim registered successfully', { pilgrim });
    } catch (error) {
        sendServerError(res, logger, 'Register pilgrim error', error);
    }
};

/**
 * Search pilgrims (by name or national ID)
 */
exports.search_pilgrims = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return sendError(res, 400, 'Search query required');
        }

        const pilgrims = await Pilgrim.find({
            $or: [
                { full_name: { $regex: query, $options: 'i' } },
                { national_id: { $regex: query, $options: 'i' } }
            ]
        }).select('full_name national_id phone_number gender age').lean();

        res.json(pilgrims);
    } catch (error) {
        sendServerError(res, logger, 'Search pilgrims error', error);
    }
};

/**
 * Get pilgrim by ID
 */
exports.get_pilgrim_by_id = async (req, res) => {
    try {
        const { pilgrim_id } = req.params;

        const query = { _id: pilgrim_id };
        
        // Moderators can only see pilgrims they created
        if (req.user.role === 'moderator') {
            query.created_by = req.user.id;
        }

        const pilgrim = await Pilgrim.findOne(query)
            .select('_id full_name national_id email phone_number medical_history age gender created_at')
            .lean();

        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        res.json(pilgrim);
    } catch (error) {
        sendServerError(res, logger, 'Get pilgrim by ID error', error);
    }
};

