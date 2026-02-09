const User = require('../models/user_model');
const PendingUser = require('../models/pending_user_model');
const Pilgrim = require('../models/pilgrim_model');
const ModeratorRequest = require('../models/moderator_request_model');
const Notification = require('../models/notification_model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');

// Public Signup: Creates Pilgrim account (no email verification required)
exports.register_user = async (req, res) => {
    try {
        const { full_name, national_id, phone_number, password, email, medical_history, age, gender } = req.body;

        // Check if national_id is already registered
        const existing_national_id = await Pilgrim.findOne({ national_id });
        if (existing_national_id) {
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: { national_id: "National ID is already registered" }
            });
        }

        // Check if phone number is already registered
        const existing_phone = await Pilgrim.findOne({ phone_number });
        if (existing_phone) {
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: { phone_number: "Phone number is already registered" }
            });
        }

        // Check if email is already registered (if provided)
        if (email && email.trim()) {
            const existing_email = await Pilgrim.findOne({ email: email.trim() });
            if (existing_email) {
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
            role: 'pilgrim'
        });

        // Generate JWT token
        const token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            success: true,
            message: "Pilgrim account created successfully",
            token,
            role: 'pilgrim',
            user_id: pilgrim._id,
            full_name: pilgrim.full_name
        });
    } catch (error) {
        console.error('Registration error:', error);
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

        res.status(201).json({
            success: true,
            message: "Email verified successfully. You can now login.",
            user_id: user._id
        });
    } catch (error) {
        console.error('Verification error:', error);
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
            .then(() => console.log(`Verification email resent to ${email}`))
            .catch(err => console.error(`Failed to resend verification email to ${email}:`, err));

        res.status(200).json({
            success: true,
            message: "Verification code resent to email"
        });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(400).json({ error: error.message });
    }
};

exports.login_user = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        // Try to find user by email, national_id, or phone_number in Pilgrim collection
        let user = await Pilgrim.findOne({
            $or: [
                { email: identifier },
                { national_id: identifier },
                { phone_number: identifier }
            ]
        });

        let role = 'pilgrim';

        // If not found in Pilgrim, try User collection (for moderators/admins)
        if (!user) {
            user = await User.findOne({
                $or: [
                    { email: identifier },
                    { phone_number: identifier }
                ]
            });
            if (user) {
                role = user.role;
            }
        } else {
            role = user.role; // Use role from Pilgrim (could be 'pilgrim' or 'moderator')
        }

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

        res.json({
            token,
            role: role,
            user_id: user._id,
            full_name: user.full_name
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get pilgrim profile (for pilgrim themselves)
exports.get_pilgrim = async (req, res) => {
    try {
        const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified');

        if (!pilgrim) return res.status(404).json({ message: "Pilgrim not found" });

        const pilgrimObj = pilgrim.toObject();
        res.json(pilgrimObj);
    } catch (error) {
        console.error('Get pilgrim error:', error);
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

        res.json({
            success: true,
            message: "Email added successfully. Please verify your email."
        });
    } catch (error) {
        console.error('Add email error:', error);
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
            .then(() => console.log(`Verification email sent to ${pilgrim.email}`))
            .catch(err => console.error(`Failed to send verification email:`, err));

        res.json({
            success: true,
            message: 'Verification code sent to your email'
        });
    } catch (error) {
        console.error('Send verification error:', error);
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

        res.json({
            success: true,
            message: 'Email verified successfully'
        });
    } catch (error) {
        console.error('Verify email error:', error);
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

        res.json({
            success: true,
            message: 'Moderator request submitted successfully. An admin will review your request.'
        });
    } catch (error) {
        console.error('Request moderator error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin: get pending moderator requests
exports.get_pending_moderator_requests = async (req, res) => {
    try {
        const requests = await ModeratorRequest.find({ status: 'pending' })
            .populate('pilgrim_id', 'full_name email phone_number')
            .sort({ requested_at: -1 });

        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Get pending moderator requests error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin: approve moderator request
exports.approve_moderator_request = async (req, res) => {
    try {
        const { request_id } = req.params;

        const request = await ModeratorRequest.findById(request_id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'Request already processed' });
        }

        request.status = 'approved';
        request.reviewed_at = new Date();
        request.reviewed_by = req.user.id;
        await request.save();

        const pilgrim = await Pilgrim.findById(request.pilgrim_id);
        if (pilgrim) {
            const existing_user = await User.findById(request.pilgrim_id);
            if (!existing_user) {
                await User.create({
                    _id: pilgrim._id,
                    full_name: pilgrim.full_name,
                    email: pilgrim.email,
                    password: pilgrim.password,
                    role: 'moderator',
                    phone_number: pilgrim.phone_number,
                    active: pilgrim.active
                });
                await Pilgrim.findByIdAndDelete(request.pilgrim_id);
            } else {
                await User.findByIdAndUpdate(request.pilgrim_id, { role: 'moderator' });
            }
        }

        await Notification.create({
            user_id: request.pilgrim_id,
            type: 'moderator_request_approved',
            title: 'Moderator Request Approved',
            message: 'Your request to become a moderator has been approved. Please log out and log back in to access moderator tools.',
            data: {
                request_id: request._id
            }
        });

        res.json({ success: true, message: 'Moderator request approved' });
    } catch (error) {
        console.error('Approve moderator request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin: reject moderator request
exports.reject_moderator_request = async (req, res) => {
    try {
        const { request_id } = req.params;
        const { notes } = req.body;

        const request = await ModeratorRequest.findById(request_id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'Request already processed' });
        }

        request.status = 'rejected';
        request.reviewed_at = new Date();
        request.reviewed_by = req.user.id;
        if (notes) request.notes = notes;
        await request.save();

        await Notification.create({
            user_id: request.pilgrim_id,
            type: 'moderator_request_rejected',
            title: 'Moderator Request Rejected',
            message: 'Your request to become a moderator was not approved at this time.',
            data: {
                request_id: request._id
            }
        });

        res.json({ success: true, message: 'Moderator request rejected' });
    } catch (error) {
        console.error('Reject moderator request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get current user profile
exports.get_profile = async (req, res) => {
    try {
        // Use role from JWT token to determine which collection to query
        if (req.user.role === 'pilgrim') {
            // Query Pilgrim collection
            const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at');

            if (!pilgrim) {
                return res.status(404).json({ message: "Profile not found" });
            }

            const latest_request = await ModeratorRequest.findOne({ pilgrim_id: req.user.id })
                .sort({ requested_at: -1 })
                .select('status');

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
            const pilgrim = await Pilgrim.findById(req.user.id).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at');
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
        console.error('Get profile error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Update user profile
exports.update_profile = async (req, res) => {
    try {
        const { full_name, phone_number, age, gender, medical_history } = req.body;
        const profile_picture = req.file ? req.file.filename : undefined;

        // Use role from JWT token to determine which collection to update
        if (req.user.role === 'pilgrim') {
            // Update Pilgrim profile
            const updateData = {
                ...(full_name && { full_name }),
                ...(phone_number && { phone_number }),
                ...(age !== undefined && { age: parseInt(age) }),
                ...(gender && { gender }),
                ...(medical_history !== undefined && { medical_history })
            };

            const updatedPilgrim = await Pilgrim.findByIdAndUpdate(
                req.user.id,
                updateData,
                { new: true }
            ).select('_id full_name email national_id phone_number medical_history age gender email_verified role created_at');

            if (!updatedPilgrim) {
                return res.status(404).json({ message: "Profile not found" });
            }

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

            return res.json({ message: "Profile updated successfully", user: updatedUser });
        }
    } catch (error) {
        console.error('Update profile error:', error);
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
        console.error('Update location error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const Group = require('../models/group_model');
const PendingPilgrim = require('../models/pending_pilgrim_model');

// ... existing code ...

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
        const existing_user = await User.findOne({ email: pending_pilgrim.email });
        const existing_pilgrim = await Pilgrim.findOne({ email: pending_pilgrim.email });
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
            $addToSet: { pilgrims: pilgrim._id }
        });

        // 5. Delete Pending Record
        await PendingPilgrim.deleteOne({ _id: pending_pilgrim._id });

        // 6. Generate Login Token
        const jwt_token = jwt.sign(
            { id: pilgrim._id, role: 'pilgrim' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            success: true,
            message: "Pilgrim account registered and added to group",
            token: jwt_token,
            role: 'pilgrim',
            full_name: pilgrim.full_name,
            user_id: pilgrim._id
        });

    } catch (error) {
        console.error('Pilgrim invitation registration error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Register a pilgrim (by moderator/admin) - no password required
exports.register_pilgrim = async (req, res) => {
    // ... existing code ...
    try {
        const { full_name, national_id, medical_history, email, age, gender, phone_number, password } = req.body;

        // Check if pilgrim already exists with this national ID
        const existing = await Pilgrim.findOne({ national_id });
        if (existing) {
            return res.status(400).json({ message: "Pilgrim with this ID already exists" });
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
            age,
            gender,
            phone_number,
            password: hashed_password, // Save password
            created_by: req.user.id
        });

        res.status(201).json({
            message: "Pilgrim registered successfully",
            pilgrim_id: pilgrim._id,
            national_id: pilgrim.national_id
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Search for pilgrims by national ID or name
exports.search_pilgrims = async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;

        if (!search || search.trim().length === 0) {
            return res.status(400).json({ message: "Search query is required" });
        }

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(20, Math.max(1, parseInt(limit) || 20)); // Max 20 per page for search
        const skip = (pageNum - 1) * limitNum;

        const searchQuery = {
            $or: [
                { national_id: { $regex: search, $options: 'i' } },
                { full_name: { $regex: search, $options: 'i' } }
            ]
        };

        if (req.user.role === 'moderator') {
            searchQuery.created_by = req.user.id;
        }

        const pilgrims = await Pilgrim.find(searchQuery)
            .select('_id full_name national_id email phone_number medical_history age gender')
            .skip(skip)
            .limit(limitNum);

        const total = await Pilgrim.countDocuments(searchQuery);

        res.json({
            success: true,
            data: pilgrims,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get pilgrim by ID (moderator/admin only)
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