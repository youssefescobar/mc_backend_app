const User = require('../models/user_model');
const PendingUser = require('../models/pending_user_model');
const Pilgrim = require('../models/pilgrim_model');
const ModeratorRequest = require('../models/moderator_request_model');
const Notification = require('../models/notification_model');
const Group = require('../models/group_model');
const PendingPilgrim = require('../models/pending_pilgrim_model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');
const { logger } = require('../config/logger');

// Public Signup: Creates Pilgrim account (no email verification required)
exports.register_user = async (req, res) => {
    try {
        const { full_name, national_id, phone_number, password, email, medical_history, age, gender, language } = req.body;

        // Check for existing user with same national_id, phone_number, or email
        const existing_pilgrim = await Pilgrim.findOne({
            $or: [
                { national_id },
                { phone_number },
                ...(email && email.trim() ? [{ email: email.trim() }] : [])
            ]
        });

        if (existing_pilgrim) {
            if (existing_pilgrim.national_id === national_id) {
                return res.status(400).json({
                    success: false,
                    message: "Validation Error",
                    errors: { national_id: "National ID is already registered" }
                });
            }
            if (existing_pilgrim.phone_number === phone_number) {
                return res.status(400).json({
                    success: false,
                    message: "Validation Error",
                    errors: { phone_number: "Phone number is already registered" }
                });
            }
            if (email && existing_pilgrim.email === email.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Validation Error",
                    errors: { email: "Email is already registered" }
                });
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
            { expiresIn: '30d' }
        );

        logger.info(`Pilgrim registered: ${pilgrim.full_name} (${pilgrim._id})`);

        res.status(201).json({
            success: true,
            message: "Pilgrim account created successfully",
            token,
            role: 'pilgrim',
            user_id: pilgrim._id,
            full_name: pilgrim.full_name
        });
    } catch (error) {
        logger.error(`Registration error: ${error.message}`);
        res.status(400).json({ error: error.message });
    }
};

// Verify email with OTP code
exports.verify_email = async (req, res) => {
    try {
        const { email, code } = req.body;

        const pending_user = await PendingUser.findOne({ email });

        if (!pending_user) {
            return res.status(400).json({
                message: "No pending registration found. Please register again."
            });
        }

        if (pending_user.verification_code !== code) {
            return res.status(400).json({ message: "Invalid verification code" });
        }

        // Create the actual user
        const user = await User.create({
            full_name: pending_user.full_name,
            email: pending_user.email,
            password: pending_user.password,
            role: 'moderator', // Default role for public self-registration
            phone_number: pending_user.phone_number
        });

        // Delete pending user
        await PendingUser.deleteOne({ email });

        logger.info(`Email verified and Moderator created: ${user.email} (${user._id})`);

        res.status(201).json({
            success: true,
            message: "Email verified successfully. You can now login.",
            user_id: user._id
        });
    } catch (error) {
        logger.error(`Verification error: ${error.message}`);
        res.status(400).json({ error: error.message });
    }
};

// Resend verification code
exports.resend_verification = async (req, res) => {
    try {
        const { email } = req.body;

        const pending_user = await PendingUser.findOne({ email });

        if (!pending_user) {
            return res.status(400).json({
                message: "No pending registration found. Please register again."
            });
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

        res.status(200).json({
            success: true,
            message: "Verification code resent to email"
        });
    } catch (error) {
        logger.error(`Resend verification error: ${error.message}`);
        res.status(400).json({ error: error.message });
    }
};

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
        let role = user ? user.role : 'pilgrim'; // Default if somehow role is missing, but schema has default

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check if account is active
        if (user.active === false) {
            return res.status(403).json({ message: 'Account is deactivated' });
        }

        // Verify password
        const is_match = await bcrypt.compare(password, user.password);
        if (!is_match) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign(
            { id: user._id, role: role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        logger.info(`User logged in: ${user._id} (${role})`);

        res.json({
            token,
            role: role,
            user_id: user._id,
            full_name: user.full_name,
            language: user.language || 'en'
        });
    } catch (error) {
        logger.error(`Login error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Logout user (clear FCM token)
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
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        logger.error(`Logout error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get pilgrim profile (for pilgrim themselves)
exports.get_pilgrim = async (req, res) => {
    try {
        const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified language');

        if (!pilgrim) return res.status(404).json({ message: "Pilgrim not found" });

        const pilgrimObj = pilgrim.toObject();
        res.json(pilgrimObj);
    } catch (error) {
        logger.error(`Get pilgrim error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Add or update email for pilgrim
exports.add_email = async (req, res) => {
    try {
        const { email } = req.body;
        const pilgrim_id = req.user.id;

        // Check if email is already in use by another pilgrim
        const existing_pilgrim = await Pilgrim.findOne({ email, _id: { $ne: pilgrim_id } });
        if (existing_pilgrim) {
            return res.status(400).json({
                success: false,
                message: "This email is already registered with another account"
            });
        }

        // Check if email is already in use by a user (moderator/admin)
        const existing_user = await User.findOne({ email });
        if (existing_user) {
            return res.status(400).json({
                success: false,
                message: "This email is already registered with another account"
            });
        }

        // Update pilgrim email and set verified to false
        await Pilgrim.findByIdAndUpdate(pilgrim_id, {
            email,
            email_verified: false
        });

        logger.info(`Pilgrim added email: ${email} (${pilgrim_id})`);

        res.json({
            success: true,
            message: "Email added successfully. Please verify your email."
        });
    } catch (error) {
        logger.error(`Add email error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Send email verification code to pilgrim
exports.send_email_verification = async (req, res) => {
    try {
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return res.status(404).json({ message: 'Pilgrim not found' });
        }

        if (!pilgrim.email) {
            return res.status(400).json({ message: 'No email address on file. Please add an email first.' });
        }

        if (pilgrim.email_verified) {
            return res.status(400).json({ message: 'Email is already verified' });
        }

        // Generate verification code
        const verification_code = generateVerificationCode();

        // Store code in PendingUser temporarily (reusing existing model)
        await PendingUser.findOneAndUpdate(
            { email: pilgrim.email },
            {
                email: pilgrim.email,
                verification_code,
                full_name: pilgrim.full_name,
                password: pilgrim.password, // Keep existing password
                phone_number: pilgrim.phone_number
            },
            { upsert: true }
        );

        // Send verification email asynchronously
        sendVerificationEmail(pilgrim.email, verification_code, pilgrim.full_name)
            .then(() => logger.info(`Verification email sent to ${pilgrim.email}`))
            .catch(err => logger.error(`Failed to send verification email: ${err.message}`));

        res.json({
            success: true,
            message: 'Verification code sent to your email'
        });
    } catch (error) {
        logger.error(`Send verification error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Verify pilgrim email with code
exports.verify_pilgrim_email = async (req, res) => {
    try {
        const { code } = req.body;
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return res.status(404).json({ message: 'Pilgrim not found' });
        }

        if (!pilgrim.email) {
            return res.status(400).json({ message: 'No email address on file' });
        }

        // Check verification code
        const pending = await PendingUser.findOne({ email: pilgrim.email });
        if (!pending) {
            return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
        }

        if (pending.verification_code !== code) {
            return res.status(400).json({ message: 'Invalid verification code' });
        }

        // Mark email as verified
        await Pilgrim.findByIdAndUpdate(pilgrim_id, {
            email_verified: true
        });

        // Clean up pending record
        await PendingUser.deleteOne({ email: pilgrim.email });

        logger.info(`Pilgrim email verified: ${pilgrim.email} (${pilgrim_id})`);

        res.json({
            success: true,
            message: 'Email verified successfully'
        });
    } catch (error) {
        logger.error(`Verify email error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Request moderator status (requires verified email)
exports.request_moderator = async (req, res) => {
    try {
        const pilgrim_id = req.user.id;

        const pilgrim = await Pilgrim.findById(pilgrim_id);
        if (!pilgrim) {
            return res.status(404).json({ message: 'Pilgrim not found' });
        }

        // Check if email exists
        if (!pilgrim.email) {
            return res.status(400).json({
                success: false,
                message: 'Email required',
                error: 'You must add an email address before requesting moderator status'
            });
        }

        // Check if email is verified
        if (!pilgrim.email_verified) {
            return res.status(400).json({
                success: false,
                message: 'Email not verified',
                error: 'You must verify your email address before requesting moderator status'
            });
        }

        // Check if already a moderator
        if (pilgrim.role === 'moderator') {
            return res.status(400).json({ message: 'You are already a moderator' });
        }

        // Check if there's already a pending request
        const existing_request = await ModeratorRequest.findOne({
            pilgrim_id,
            status: 'pending'
        });

        if (existing_request) {
            return res.status(400).json({ message: 'You already have a pending moderator request' });
        }

        // Create moderator request
        await ModeratorRequest.create({
            pilgrim_id
        });

        logger.info(`Moderator request submitted: ${pilgrim_id}`);

        res.json({
            success: true,
            message: 'Moderator request submitted successfully. An admin will review your request.'
        });
    } catch (error) {
        logger.error(`Request moderator error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get current user profile
exports.get_profile = async (req, res) => {
    try {
        // Use role from JWT token to determine which collection to query
        if (req.user.role === 'pilgrim') {
            // Query Pilgrim collection
            const [pilgrim, latest_request] = await Promise.all([
                Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at language'),
                ModeratorRequest.findOne({ pilgrim_id: req.user.id }).sort({ requested_at: -1 }).select('status')
            ]);

            if (!pilgrim) {
                return res.status(404).json({ message: "Profile not found" });
            }

            const moderator_request_status = latest_request?.status || null;

            return res.json({
                ...pilgrim.toObject(),
                moderator_request_status,
                pending_moderator_request: moderator_request_status === 'pending'
            });
        } else {
            // Query User collection (moderator/admin)
            const user = await User.findById(req.user.id).select('_id full_name email role phone_number profile_picture created_at');

            if (user) {
                return res.json(user);
            }

            // Fallback: approved moderators may still exist in Pilgrim collection
            const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at language');
            if (!pilgrim) {
                return res.status(404).json({ message: "Profile not found" });
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
        logger.error(`Get profile error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Update user profile
exports.update_profile = async (req, res) => {
    try {
        const { full_name, phone_number, age, gender, medical_history, language } = req.body;
        const profile_picture = req.file ? req.file.filename : undefined;

        // Use role from JWT token to determine which collection to update
        if (req.user.role === 'pilgrim') {
            // Update Pilgrim profile
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
                return res.status(404).json({ message: "Profile not found" });
            }

            logger.info(`Pilgrim profile updated: ${req.user.id}`);
            return res.json({ message: "Profile updated successfully", user: updatedPilgrim });
        } else {
            // Update User profile (moderator/admin)
            const updateData = {
                ...(full_name && { full_name }),
                ...(phone_number && { phone_number })
            };

            if (profile_picture) {
                updateData.profile_picture = profile_picture;
            }

            const updatedUser = await User.findByIdAndUpdate(
                req.user.id,
                updateData,
                { new: true }
            ).select('_id full_name email role phone_number profile_picture created_at');

            if (!updatedUser) {
                return res.status(404).json({ message: "Profile not found" });
            }

            logger.info(`User profile updated: ${req.user.id}`);
            return res.json({ message: "Profile updated successfully", user: updatedUser });
        }
    } catch (error) {
        logger.error(`Update profile error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Update language preference
exports.update_language = async (req, res) => {
    try {
        const { language } = req.body;

        if (req.user.role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(
                req.user.id,
                { language },
                { new: true }
            );
        }
        // Could also update for User/Moderator if they have a language field

        logger.info(`Example: User ${req.user.id} updated language to ${language}`);
        res.json({ message: "Language updated successfully" });
    } catch (error) {
        logger.error(`Update language error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Update user location (Moderator)
exports.update_location = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({ message: 'Latitude and longitude required' });
        }

        await User.findByIdAndUpdate(
            req.user.id,
            {
                current_latitude: latitude,
                current_longitude: longitude,
                last_location_update: new Date()
            }
        );

        res.json({ message: 'Location updated' });
    } catch (error) {
        logger.error(`Update location error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Register a new pilgrim via invitation link
exports.register_invited_pilgrim = async (req, res) => {
    try {
        const { full_name, password, token } = req.body;

        // 1. Validate Token
        const pending_pilgrim = await PendingPilgrim.findOne({ verification_token: token });

        if (!pending_pilgrim) {
            return res.status(400).json({ message: "Invalid or expired invitation token" });
        }

        if (new Date() > pending_pilgrim.expires_at) {
            return res.status(400).json({ message: "Invitation has expired" });
        }

        // 2. Check if email already registered (as User or Pilgrim)
        // Should ideally update existing record if migrated, but for now assuming new account
        const [existing_user, existing_pilgrim] = await Promise.all([
            User.findOne({ email: pending_pilgrim.email }),
            Pilgrim.findOne({ email: pending_pilgrim.email })
        ]);

        if (existing_user || existing_pilgrim) {
            return res.status(400).json({ message: "Email is already registered. Please login." });
        }

        // 3. Create Pilgrim Account
        const hashed_password = await bcrypt.hash(password, 10);

        const pilgrim = await Pilgrim.create({
            full_name,
            email: pending_pilgrim.email,
            password: hashed_password,
            created_by: pending_pilgrim.invited_by
        });

        // 4. Add Pilgrim to Group
        await Group.findByIdAndUpdate(pending_pilgrim.group_id, {
            $addToSet: { pilgrim_ids: pilgrim._id }
        });

        // 5. Delete Pending Record
        await PendingPilgrim.deleteOne({ _id: pending_pilgrim._id });

        // 6. Generate Login Token
        const jwt_token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        logger.info(`Invited pilgrim registered: ${pilgrim.full_name} (${pilgrim._id})`);

        res.status(201).json({
            success: true,
            message: "Pilgrim account registered and added to group",
            token: jwt_token,
            role: 'pilgrim',
            full_name: pilgrim.full_name,
            user_id: pilgrim._id
        });

    } catch (error) {
        logger.error(`Pilgrim invitation registration error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Register a pilgrim (by moderator/admin) - no password required
exports.register_pilgrim = async (req, res) => {
    try {
        const { full_name, national_id, medical_history, email, age, gender, phone_number, password } = req.body;

        // Check if pilgrim already exists with this national ID or phone number
        const existing_pilgrim = await Pilgrim.findOne({
            $or: [
                { national_id },
                ...(phone_number ? [{ phone_number }] : [])
            ]
        });

        if (existing_pilgrim) {
            if (existing_pilgrim.national_id === national_id) {
                return res.status(400).json({ message: "Pilgrim with this ID already exists" });
            }
            if (phone_number && existing_pilgrim.phone_number === phone_number) {
                return res.status(400).json({ message: "Phone number already registered" });
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
            created_by: req.user.id // Moderator ID
        });

        logger.info(`Pilgrim manually registered by moderator: ${pilgrim._id}`);

        res.status(201).json({
            success: true,
            message: "Pilgrim registered successfully",
            pilgrim
        });
    } catch (error) {
        logger.error(`Register pilgrim error: ${error.message}`);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Search pilgrims (by name or national ID)
exports.search_pilgrims = async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ message: "Search query required" });
        }

        const pilgrims = await Pilgrim.find({
            $or: [
                { full_name: { $regex: query, $options: 'i' } },
                { national_id: { $regex: query, $options: 'i' } }
            ]
        }).select('full_name national_id phone_number gender age');

        res.json(pilgrims);
    } catch (error) {
        logger.error(`Search pilgrims error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get pilgrim by ID
exports.get_pilgrim_by_id = async (req, res) => {
    try {
        const { pilgrim_id } = req.params;

        const query = { _id: pilgrim_id };
        if (req.user.role === 'moderator') {
            query.created_by = req.user.id;
        }

        const pilgrim = await Pilgrim.findOne(query)
            .select('_id full_name national_id email phone_number medical_history age gender created_at');

        if (!pilgrim) {
            return res.status(404).json({ message: "Pilgrim not found" });
        }

        const pilgrimObj = pilgrim.toObject ? pilgrim.toObject() : pilgrim;

        res.json(pilgrimObj);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update FCM Token
exports.update_fcm_token = async (req, res) => {
    try {
        const { fcm_token } = req.body;

        if (!fcm_token) {
            return res.status(400).json({ message: "FCM Token is required" });
        }

        if (req.user.role === 'pilgrim') {
            await Pilgrim.findByIdAndUpdate(req.user.id, { fcm_token });
        } else {
            await User.findByIdAndUpdate(req.user.id, { fcm_token });
        }

        res.json({ success: true, message: "FCM Token updated" });
    } catch (error) {
        console.error('Update FCM Token error:', error);
        res.status(500).json({ message: "Server error" });
    }
};