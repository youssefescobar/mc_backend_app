const User = require('../models/user_model');
const PendingUser = require('../models/pending_user_model');
const Group = require('../models/group_model');
const Hotel = require('../models/hotel_model');
const Bus = require('../models/bus_model');
const PendingPilgrim = require('../models/pending_pilgrim_model');
const ModeratorRequest = require('../models/moderator_request_model');
const Notification = require('../models/notification_model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');
const mongoose = require('mongoose');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');
const { logger } = require('../config/logger');
const { sendSuccess, sendError, sendValidationError, sendServerError, JWT_EXPIRATION } = require('../utils/response_helpers');

const toObjectId = (value) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

const normalizeString = (value) => String(value || '').trim();

const ONE_TIME_LOGIN_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const randomPassword = () => crypto.randomBytes(24).toString('base64url');

const randomLoginToken = () => {
    let suffix = '';
    const bytes = crypto.randomBytes(8);
    for (let index = 0; index < bytes.length; index += 1) {
        suffix += LOGIN_TOKEN_ALPHABET[bytes[index] % LOGIN_TOKEN_ALPHABET.length];
    }
    return `MC${suffix}`;
};

const buildVisaPayload = (visa = {}) => {
    const status = normalizeString(visa.status) || undefined;
    const visa_number = normalizeString(visa.visa_number) || undefined;
    const issue_date = visa.issue_date ? new Date(visa.issue_date) : undefined;
    const expiry_date = visa.expiry_date ? new Date(visa.expiry_date) : undefined;

    if (!status && !visa_number && !issue_date && !expiry_date) {
        return undefined;
    }

    return {
        ...(visa_number ? { visa_number } : {}),
        ...(status ? { status } : {}),
        ...(issue_date ? { issue_date } : {}),
        ...(expiry_date ? { expiry_date } : {}),
    };
};

const issueOneTimePilgrimLogin = async ({ pilgrim, moderatorId }) => {
    let token = null;
    let token_hash = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const candidate = randomLoginToken();
        const candidateHash = hashToken(candidate);
        const exists = await User.exists({ 'one_time_login.token_hash': candidateHash });
        if (!exists) {
            token = candidate;
            token_hash = candidateHash;
            break;
        }
    }

    if (!token || !token_hash) {
        throw new Error('Failed to issue unique one-time login token');
    }

    const issued_at = new Date();
    const expires_at = new Date(Date.now() + ONE_TIME_LOGIN_TTL_MS);

    pilgrim.one_time_login = {
        token_hash,
        token_plain: token,
        issued_at,
        expires_at,
        used_at: null,
        issued_by: moderatorId,
    };

    await pilgrim.save();

    const payload = `mcare://pilgrim-login?token=${encodeURIComponent(token)}`;
    const qr_code_data_url = await QRCode.toDataURL(payload, { width: 280, margin: 1 });

    return {
        token,
        expires_at,
        qr_payload: payload,
        qr_code_data_url,
    };
};

const canManageGroup = (group, user) => {
    if (!group || !user) return false;
    if (user.role === 'admin') return true;
    return (group.moderator_ids || []).some((id) => id.toString() === String(user.id));
};

const resolveGroupAssignmentFields = async ({ group, row }) => {
    const normalizedHotelId = normalizeString(row.hotel_id);
    const normalizedBusId = normalizeString(row.bus_id);
    const normalizedRoomId = normalizeString(row.room_id);
    const normalizedHotelName = normalizeString(row.hotel_name);
    const normalizedBusInfo = normalizeString(row.bus_info);
    const normalizedRoomNumber = normalizeString(row.room_number);

    let hotel_name;
    let bus_info;
    let room_number;

    const assignedHotelIds = (group.assigned_hotel_ids || []).map((id) => id.toString());
    const assignedBusIds = (group.assigned_bus_ids || []).map((id) => id.toString());

    if (normalizedHotelId) {
        if (!assignedHotelIds.includes(normalizedHotelId)) {
            throw new Error('Selected hotel is not assigned to this group');
        }

        const hotel = await Hotel.findById(normalizedHotelId).lean();
        if (!hotel || !hotel.active) {
            throw new Error('Selected hotel is unavailable');
        }

        hotel_name = hotel.name;

        if (normalizedRoomId) {
            const room = (hotel.rooms || []).find((item) => item._id.toString() === normalizedRoomId && item.active);
            if (!room) {
                throw new Error('Selected room is invalid for selected hotel');
            }
            room_number = room.room_number;
        } else if (normalizedRoomNumber) {
            const room = (hotel.rooms || []).find((item) => String(item.room_number || '').trim().toLowerCase() === normalizedRoomNumber.toLowerCase() && item.active);
            if (!room) {
                throw new Error('Room number is not available in selected hotel');
            }
            room_number = room.room_number;
        }
    } else if (normalizedHotelName) {
        const assignedHotels = await Hotel.find({ _id: { $in: assignedHotelIds }, active: true }).lean();
        const matchedHotel = assignedHotels.find((item) => String(item.name || '').trim().toLowerCase() === normalizedHotelName.toLowerCase());
        if (!matchedHotel) {
            throw new Error('Hotel name is not assigned to this group');
        }
        hotel_name = matchedHotel.name;
        if (normalizedRoomNumber) {
            const room = (matchedHotel.rooms || []).find((item) => String(item.room_number || '').trim().toLowerCase() === normalizedRoomNumber.toLowerCase() && item.active);
            if (!room) {
                throw new Error('Room number is not available in selected hotel');
            }
            room_number = room.room_number;
        }
    }

    if (normalizedBusId) {
        if (!assignedBusIds.includes(normalizedBusId)) {
            throw new Error('Selected bus is not assigned to this group');
        }

        const bus = await Bus.findById(normalizedBusId).lean();
        if (!bus || !bus.active) {
            throw new Error('Selected bus is unavailable');
        }

        bus_info = `${bus.bus_number} - ${bus.destination}`;
    } else if (normalizedBusInfo) {
        const assignedBuses = await Bus.find({ _id: { $in: assignedBusIds }, active: true }).lean();
        const matchedBus = assignedBuses.find((item) => {
            const key = `${item.bus_number} - ${item.destination}`.toLowerCase();
            return key === normalizedBusInfo.toLowerCase();
        });
        if (!matchedBus) {
            throw new Error('Bus info is not assigned to this group');
        }
        bus_info = `${matchedBus.bus_number} - ${matchedBus.destination}`;
    }

    return {
        hotel_name: hotel_name || undefined,
        bus_info: bus_info || undefined,
        room_number: room_number || (normalizedRoomNumber || undefined),
    };
};

/**
 * Register a new pilgrim account (public signup)
 */
exports.register_user = async (req, res) => {
    try {
        const { full_name, national_id, phone_number, password, email, medical_history, age, gender, language } = req.body;

        // Check for existing user with same credentials
        const existing_user = await User.findOne({
            $or: [
                { national_id },
                { phone_number },
                ...(email && email.trim() ? [{ email: email.trim() }] : [])
            ]
        });

        if (existing_user) {
            if (existing_user.national_id === national_id) {
                return sendValidationError(res, { national_id: 'National ID is already registered' });
            }
            if (existing_user.phone_number === phone_number) {
                return sendValidationError(res, { phone_number: 'Phone number is already registered' });
            }
            if (email && existing_user.email === email.trim()) {
                return sendValidationError(res, { email: 'Email is already registered' });
            }
        }

        const hashed_password = await bcrypt.hash(password, 10);

        // Create Pilgrim account
        const pilgrim = await User.create({
            full_name,
            national_id,
            phone_number,
            password: hashed_password,
            email: email && email.trim() ? email.trim() : undefined,
            medical_history,
            age,
            gender,
            language: language || 'en',
            user_type: 'pilgrim'
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
        const safe_email = normalizeString(email).toLowerCase();

        const pending_user = await PendingUser.findOne({ email: safe_email });

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
        await PendingUser.deleteOne({ email: safe_email });

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
        const safe_email = normalizeString(email).toLowerCase();

        const pending_user = await PendingUser.findOne({ email: safe_email });

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
        sendVerificationEmail(safe_email, verification_code, pending_user.full_name)
            .then(() => logger.info(`Verification email resent to ${safe_email}`))
            .catch(err => logger.error(`Failed to resend verification email to ${safe_email}: ${err.message}`));

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
        const normalized_identifier = String(identifier || '').trim();

        logger.info(`[LOGIN DEBUG] identifier="${normalized_identifier}", password length=${password ? password.length : 0}`);

        if (!normalized_identifier) {
            return sendValidationError(res, { identifier: 'Email, national ID, or phone number is required' });
        }

        const is_email_identifier = normalized_identifier.includes('@');
        const escaped_identifier = normalized_identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Also try with '+' prefix for phone numbers entered without it
        const phone_variants = [normalized_identifier];
        if (/^\d+$/.test(normalized_identifier)) {
            phone_variants.push(`+${normalized_identifier}`);
        }

        const query = {
            $or: [
                ...(is_email_identifier
                    ? [{ email: { $regex: `^${escaped_identifier}$`, $options: 'i' } }]
                    : [{ email: normalized_identifier }]),
                { national_id: normalized_identifier },
                { phone_number: { $in: phone_variants } }
            ]
        };
        logger.info(`[LOGIN DEBUG] query=${JSON.stringify(query)}`);

        // Find user by identifier (email, national_id, or phone_number)
        const user = await User.findOne(query);

        if (!user) {
            logger.warn(`[LOGIN DEBUG] No user found for identifier="${normalized_identifier}"`);
            return sendError(res, 401, 'Invalid credentials');
        }

        logger.info(`[LOGIN DEBUG] Found user: _id=${user._id}, email=${user.email}, national_id=${user.national_id}, phone=${user.phone_number}, user_type=${user.user_type}, has_password=${!!user.password}, password_hash_prefix=${user.password ? user.password.substring(0, 10) : 'NONE'}`);

        // Check if account is active
        if (user.active === false) {
            return sendError(res, 403, 'Account is deactivated');
        }

        // Verify password
        const is_match = await bcrypt.compare(password, user.password);
        logger.info(`[LOGIN DEBUG] bcrypt.compare result=${is_match}`);
        if (!is_match) {
            return sendError(res, 401, 'Invalid credentials');
        }

        // Generate token
        const token = jwt.sign(
            { id: user._id, role: user.user_type },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        logger.info(`User logged in: ${user._id} (${user.user_type})`);

        res.json({
            token,
            role: user.user_type,
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
        const user_id = toObjectId(req.user.id);
        if (!user_id) {
            return sendError(res, 400, 'Invalid user identifier');
        }

        await User.findByIdAndUpdate(user_id, { 
            fcm_token: null,
            is_online: false,
            last_active_at: new Date()
        });

        // Notify group members about status change
        const group = await Group.findOne({ pilgrim_ids: user_id });
        if (group) {
            const io = req.app.get('io');
            if (io) {
                io.to(`group_${group._id}`).emit('status_update', {
                    pilgrimId: user_id,
                    active: false,
                    last_active_at: new Date()
                });
            }
        }

        logger.info(`User logged out: ${user_id}`);
        sendSuccess(res, 200, 'Logged out successfully');
    } catch (error) {
        sendServerError(res, logger, 'Logout error', error);
    }
};

/**
 * Refresh session token using the current role from DB.
 * This allows seamless role upgrades (pilgrim -> moderator) without re-login.
 */
exports.refresh_session = async (req, res) => {
    try {
        const user_id = toObjectId(req.user.id);
        if (!user_id) {
            return sendError(res, 400, 'Invalid user identifier');
        }

        const user = await User.findById(user_id).select('_id full_name user_type');

        if (!user) {
            return sendError(res, 404, 'User not found');
        }

        let moderator_request_status = null;
        const latest_request = await ModeratorRequest.findOne({ pilgrim_id: user._id })
            .sort({ requested_at: -1 })
            .select('_id status');
        if (latest_request) {
            moderator_request_status = latest_request.status;
        }

        // Ensure approval notification exists once, then notify app to refresh alerts.
        if (latest_request?.status === 'approved') {
            const existing_approval_notification = await Notification.findOne({
                user_id: user._id,
                type: 'moderator_request_approved',
                'data.request_id': latest_request._id,
            });

            if (!existing_approval_notification) {
                await Notification.create({
                    user_id: user._id,
                    type: 'moderator_request_approved',
                    title: 'Moderator Request Approved',
                    message: 'Your moderator request has been approved. You can now switch to the moderator dashboard.',
                    data: {
                        request_id: latest_request._id,
                    },
                });

                const io = req.app.get('socketio');
                if (io) {
                    io.to(`user_${user._id}`).emit('notification_refresh');
                    io.to(`user_${user._id}`).emit('moderator-request-approved', {
                        requestId: latest_request._id.toString(),
                    });
                }
            }
        }

        const token = jwt.sign(
            { id: user._id, role: user.user_type },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        sendSuccess(res, 200, 'Session refreshed', {
            token,
            role: user.user_type,
            user_id: user._id,
            full_name: user.full_name,
            moderator_request_status,
        });
    } catch (error) {
        sendServerError(res, logger, 'Refresh session error', error);
    }
};

/**
 * Register a new pilgrim via invitation link
 */
exports.register_invited_pilgrim = async (req, res) => {
    try {
        const { full_name, password, token } = req.body;
        const safe_token = typeof token === 'string' ? token.trim() : '';

        if (!safe_token) {
            return sendError(res, 400, 'Invitation token is required');
        }

        // Validate Token
        const pending_pilgrim = await PendingPilgrim.findOne({ verification_token: safe_token });

        if (!pending_pilgrim) {
            return sendError(res, 400, 'Invalid or expired invitation token');
        }

        if (new Date() > pending_pilgrim.expires_at) {
            return sendError(res, 400, 'Invitation has expired');
        }

        // Check if email already registered
        const existing_user = await User.findOne({ email: pending_pilgrim.email });

        if (existing_user) {
            return sendError(res, 400, 'Email is already registered. Please login.');
        }

        // Create Pilgrim Account
        const hashed_password = await bcrypt.hash(password, 10);

        const pilgrim = await User.create({
            full_name,
            email: pending_pilgrim.email,
            password: hashed_password,
            user_type: 'pilgrim',
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
        const existing_user = await User.findOne({
            $or: [
                { national_id },
                ...(phone_number ? [{ phone_number }] : [])
            ]
        });

        if (existing_user) {
            if (existing_user.national_id === national_id) {
                return sendValidationError(res, { national_id: 'Pilgrim with this ID already exists' });
            }
            if (phone_number && existing_user.phone_number === phone_number) {
                return sendValidationError(res, { phone_number: 'Phone number already registered' });
            }
        }

        // Hash password if provided
        let hashed_password = undefined;
        if (password) {
            hashed_password = await bcrypt.hash(password, 10);
        }

        const pilgrim = await User.create({
            full_name,
            national_id,
            medical_history,
            email,
            phone_number,
            age,
            gender,
            password: hashed_password,
            user_type: 'pilgrim',
            created_by: toObjectId(req.user.id)
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
        const query_text = normalizeString(req.query.query);

        if (!query_text) {
            return sendError(res, 400, 'Search query required');
        }

        const escaped_query = query_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const pilgrims = await User.find({
            user_type: 'pilgrim',
            $or: [
                { full_name: { $regex: escaped_query, $options: 'i' } },
                { national_id: { $regex: escaped_query, $options: 'i' } }
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
        const pilgrim_id = toObjectId(req.params.pilgrim_id);
        if (!pilgrim_id) {
            return sendError(res, 400, 'Invalid pilgrim identifier');
        }

        const query = { _id: pilgrim_id };
        
        // Moderators can only see pilgrims they created
        if (req.user.role === 'moderator') {
            query.created_by = req.user.id;
        }

        const pilgrim = await User.findOne(query)
            .select('_id full_name national_id email phone_number medical_history age gender language room_number bus_info hotel_name ethnicity visa moderated_by created_at')
            .lean();

        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        res.json(pilgrim);
    } catch (error) {
        sendServerError(res, logger, 'Get pilgrim by ID error', error);
    }
};

/**
 * Moderator/Admin provisions a pilgrim and assigns to group with one-time QR login.
 */
exports.provision_pilgrim = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) {
            return sendError(res, 400, 'Invalid group identifier');
        }

        const group = await Group.findById(group_id).select('_id group_name moderator_ids pilgrim_ids assigned_hotel_ids assigned_bus_ids');
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        if (!canManageGroup(group, req.user)) {
            return sendError(res, 403, 'Not authorized to manage this group');
        }

        const full_name = normalizeString(req.body.full_name);
        const phone_number = normalizeString(req.body.phone_number);
        const national_id = normalizeString(req.body.national_id) || undefined;
        const email = normalizeString(req.body.email).toLowerCase() || undefined;

        const duplicateQuery = {
            user_type: 'pilgrim',
            $or: [
                { phone_number },
                ...(national_id ? [{ national_id }] : []),
                ...(email ? [{ email }] : []),
            ],
        };

        const existing = await User.findOne(duplicateQuery);
        if (existing) {
            return sendError(res, 409, 'Pilgrim already exists with this phone, national ID, or email');
        }

        let resourceFields;
        try {
            resourceFields = await resolveGroupAssignmentFields({ group, row: req.body });
        } catch (error) {
            return sendError(res, 400, error.message || 'Invalid hotel/bus assignment');
        }

        const pilgrim = await User.create({
            full_name,
            phone_number,
            national_id,
            email,
            password: await bcrypt.hash(randomPassword(), 10),
            user_type: 'pilgrim',
            age: req.body.age,
            gender: req.body.gender,
            language: req.body.language || 'en',
            medical_history: normalizeString(req.body.medical_history) || undefined,
            room_number: resourceFields.room_number,
            bus_info: resourceFields.bus_info,
            hotel_name: resourceFields.hotel_name,
            ethnicity: normalizeString(req.body.ethnicity) || undefined,
            visa: buildVisaPayload(req.body.visa),
            created_by: toObjectId(req.user.id),
            moderated_by: toObjectId(req.user.id),
        });

        await Group.findByIdAndUpdate(group_id, { $addToSet: { pilgrim_ids: pilgrim._id } });
        const login = await issueOneTimePilgrimLogin({ pilgrim, moderatorId: toObjectId(req.user.id) });

        sendSuccess(res, 201, 'Pilgrim provisioned successfully', {
            pilgrim: {
                _id: pilgrim._id,
                full_name: pilgrim.full_name,
                phone_number: pilgrim.phone_number,
                group_id,
            },
            one_time_login: login,
        });
    } catch (error) {
        sendServerError(res, logger, 'Provision pilgrim error', error);
    }
};

/**
 * Moderator/Admin bulk provisions pilgrims from parsed spreadsheet rows.
 */
exports.provision_pilgrims_bulk = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) {
            return sendError(res, 400, 'Invalid group identifier');
        }

        const group = await Group.findById(group_id).select('_id group_name moderator_ids pilgrim_ids assigned_hotel_ids assigned_bus_ids');
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        if (!canManageGroup(group, req.user)) {
            return sendError(res, 403, 'Not authorized to manage this group');
        }

        const rows = Array.isArray(req.body.pilgrims) ? req.body.pilgrims : [];
        const created = [];
        const skipped = [];

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index] || {};
            const full_name = normalizeString(row.full_name);
            const phone_number = normalizeString(row.phone_number);
            const national_id = normalizeString(row.national_id) || undefined;
            const email = normalizeString(row.email).toLowerCase() || undefined;

            if (!full_name || !phone_number) {
                skipped.push({
                    row: index + 1,
                    reason: 'Missing required fields (full_name, phone_number)',
                });
                continue;
            }

            const existing = await User.findOne({
                user_type: 'pilgrim',
                $or: [
                    { phone_number },
                    ...(national_id ? [{ national_id }] : []),
                    ...(email ? [{ email }] : []),
                ],
            }).select('_id full_name');

            if (existing) {
                skipped.push({
                    row: index + 1,
                    reason: `Duplicate pilgrim (${existing.full_name})`,
                });
                continue;
            }

            let resourceFields;
            try {
                resourceFields = await resolveGroupAssignmentFields({ group, row });
            } catch (error) {
                skipped.push({
                    row: index + 1,
                    reason: error.message || 'Invalid hotel/bus assignment',
                });
                continue;
            }

            const pilgrim = await User.create({
                full_name,
                phone_number,
                national_id,
                email,
                password: await bcrypt.hash(randomPassword(), 10),
                user_type: 'pilgrim',
                age: row.age,
                gender: row.gender,
                language: row.language || 'en',
                medical_history: normalizeString(row.medical_history) || undefined,
                room_number: resourceFields.room_number,
                bus_info: resourceFields.bus_info,
                hotel_name: resourceFields.hotel_name,
                ethnicity: normalizeString(row.ethnicity) || undefined,
                visa: buildVisaPayload(row.visa),
                created_by: toObjectId(req.user.id),
                moderated_by: toObjectId(req.user.id),
            });

            await Group.findByIdAndUpdate(group_id, { $addToSet: { pilgrim_ids: pilgrim._id } });
            const login = await issueOneTimePilgrimLogin({ pilgrim, moderatorId: toObjectId(req.user.id) });

            created.push({
                row: index + 1,
                pilgrim: {
                    _id: pilgrim._id,
                    full_name: pilgrim.full_name,
                    phone_number: pilgrim.phone_number,
                },
                one_time_login: login,
            });
        }

        sendSuccess(res, 200, 'Bulk provisioning completed', {
            summary: {
                total_rows: rows.length,
                created_count: created.length,
                skipped_count: skipped.length,
            },
            created,
            skipped,
        });
    } catch (error) {
        sendServerError(res, logger, 'Bulk provision pilgrims error', error);
    }
};

/**
 * Moderator/Admin fetches provisioning lifecycle for a group.
 */
exports.get_group_provisioning_status = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) {
            return sendError(res, 400, 'Invalid group identifier');
        }

        const group = await Group.findById(group_id).select('_id group_name moderator_ids pilgrim_ids');
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        if (!canManageGroup(group, req.user)) {
            return sendError(res, 403, 'Not authorized to manage this group');
        }

        const pilgrims = await User.find({
            _id: { $in: group.pilgrim_ids || [] },
            user_type: 'pilgrim',
        })
            .select('_id full_name phone_number one_time_login created_at')
            .sort({ created_at: -1 })
            .lean();

        const items = [];

        for (const pilgrim of pilgrims) {
            const login = pilgrim.one_time_login || {};
            const hasProvisioningData = Boolean(
                login.token_hash || login.token_plain || login.issued_at || login.expires_at || login.used_at
            );

            if (!hasProvisioningData) continue;

            const used_at = login.used_at ? new Date(login.used_at) : null;
            const issued_at = login.issued_at ? new Date(login.issued_at) : null;
            const expires_at = login.expires_at ? new Date(login.expires_at) : null;
            const isExpired = Boolean(expires_at && expires_at.getTime() < Date.now());

            let status = 'pending';
            if (used_at) {
                status = 'activated';
            } else if (isExpired) {
                status = 'expired';
            }

            const token = status === 'activated' ? null : (login.token_plain || null);
            let qr_code_data_url = null;

            if (token) {
                const payload = `mcare://pilgrim-login?token=${encodeURIComponent(token)}`;
                qr_code_data_url = await QRCode.toDataURL(payload, { width: 280, margin: 1 });
            }

            items.push({
                pilgrim: {
                    _id: pilgrim._id,
                    full_name: pilgrim.full_name,
                    phone_number: pilgrim.phone_number,
                },
                one_time_login: {
                    token,
                    issued_at,
                    expires_at,
                    used_at,
                    qr_code_data_url,
                },
                status,
            });
        }

        const summary = {
            total_provisioned: items.length,
            pending_count: items.filter((item) => item.status === 'pending').length,
            activated_count: items.filter((item) => item.status === 'activated').length,
            expired_count: items.filter((item) => item.status === 'expired').length,
            pending_with_visible_token_count: items.filter((item) => item.status !== 'activated' && item.one_time_login.token).length,
        };

        sendSuccess(res, 200, null, {
            summary,
            items,
        });
    } catch (error) {
        sendServerError(res, logger, 'Get group provisioning status error', error);
    }
};

/**
 * Moderator/Admin reissues a one-time login token for a pilgrim in their group.
 */
exports.reissue_pilgrim_login = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const pilgrim_id = toObjectId(req.params.pilgrim_id);

        if (!group_id || !pilgrim_id) {
            return sendError(res, 400, 'Invalid group or pilgrim identifier');
        }

        const group = await Group.findById(group_id).select('_id group_name moderator_ids pilgrim_ids');
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        if (!canManageGroup(group, req.user)) {
            return sendError(res, 403, 'Not authorized to manage this group');
        }

        const isMember = (group.pilgrim_ids || []).some((id) => id.toString() === pilgrim_id.toString());
        if (!isMember) {
            return sendError(res, 404, 'Pilgrim is not part of this group');
        }

        const pilgrim = await User.findOne({ _id: pilgrim_id, user_type: 'pilgrim' });
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        // Clear device binding and set offline to allow login from a new device
        pilgrim.bound_device_id = null;
        pilgrim.fcm_token = null;
        pilgrim.is_online = false;
        pilgrim.last_active_at = new Date();

        const login = await issueOneTimePilgrimLogin({ pilgrim, moderatorId: toObjectId(req.user.id) });

        // Emit socket events to force logout on the current device and update group status
        const io = req.app.get('io') || req.app.get('socketio');
        if (io) {
            io.to(`user_${pilgrim._id}`).emit('force_logout');
            io.to(`group_${group._id}`).emit('status_update', {
                pilgrimId: pilgrim._id,
                active: false,
                last_active_at: new Date()
            });
        }

        sendSuccess(res, 200, 'One-time login token reissued', {
            pilgrim: {
                _id: pilgrim._id,
                full_name: pilgrim.full_name,
                phone_number: pilgrim.phone_number,
            },
            one_time_login: login,
        });
    } catch (error) {
        sendServerError(res, logger, 'Reissue pilgrim login error', error);
    }
};

/**
 * Moderator/Admin deletes a provisioned pilgrim account from a managed group.
 */
exports.delete_provisioned_pilgrim = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const pilgrim_id = toObjectId(req.params.pilgrim_id);

        if (!group_id || !pilgrim_id) {
            return sendError(res, 400, 'Invalid group or pilgrim identifier');
        }

        const group = await Group.findById(group_id).select('_id group_name moderator_ids pilgrim_ids');
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        if (!canManageGroup(group, req.user)) {
            return sendError(res, 403, 'Not authorized to manage this group');
        }

        const isMember = (group.pilgrim_ids || []).some((id) => id.toString() === pilgrim_id.toString());
        if (!isMember) {
            return sendError(res, 404, 'Pilgrim is not part of this group');
        }

        const pilgrim = await User.findOne({ _id: pilgrim_id, user_type: 'pilgrim' }).select('_id full_name');
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        await Group.findByIdAndUpdate(group_id, { $pull: { pilgrim_ids: pilgrim_id } });
        await User.deleteOne({ _id: pilgrim_id, user_type: 'pilgrim' });

        sendSuccess(res, 200, 'Pilgrim account deleted successfully', {
            pilgrim: {
                _id: pilgrim_id,
                full_name: pilgrim.full_name,
            },
        });
    } catch (error) {
        sendServerError(res, logger, 'Delete provisioned pilgrim error', error);
    }
};

/**
 * Pilgrim one-time QR token login with device binding.
 */
exports.pilgrim_one_time_login = async (req, res) => {
    try {
        const token = normalizeString(req.body.token);
        const device_id = normalizeString(req.body.device_id);

        const token_hash = hashToken(token);
        const pilgrim = await User.findOne({
            user_type: 'pilgrim',
            'one_time_login.token_hash': token_hash,
        });

        if (!pilgrim) {
            return sendError(res, 401, 'Invalid one-time token');
        }

        if (!pilgrim.one_time_login?.expires_at || new Date(pilgrim.one_time_login.expires_at) < new Date()) {
            return sendError(res, 401, 'One-time token expired');
        }

        if (pilgrim.one_time_login?.used_at) {
            return sendError(res, 401, 'One-time token already used');
        }

        if (pilgrim.bound_device_id && pilgrim.bound_device_id !== device_id) {
            return sendError(res, 403, 'Account is bound to another device. Contact moderator to reset.');
        }

        pilgrim.bound_device_id = device_id;
        pilgrim.one_time_login.used_at = new Date();
        pilgrim.one_time_login.token_plain = null;
        await pilgrim.save();

        const jwt_token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRATION }
        );

        sendSuccess(res, 200, 'Login successful', {
            token: jwt_token,
            role: 'pilgrim',
            user_id: pilgrim._id,
            full_name: pilgrim.full_name,
            language: pilgrim.language || 'en',
        });
    } catch (error) {
        sendServerError(res, logger, 'Pilgrim one-time login error', error);
    }
};

