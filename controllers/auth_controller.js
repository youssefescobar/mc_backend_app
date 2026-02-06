const User = require('../models/user_model');
const PendingUser = require('../models/pending_user_model');
const Pilgrim = require('../models/pilgrim_model');
const HardwareBand = require('../models/hardware_band_model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateVerificationCode, sendVerificationEmail } = require('../config/email_service');

// Public Signup: Defaults to 'moderator' - Now requires email verification
exports.register_user = async (req, res) => {
    try {
        const { full_name, email, password, phone_number } = req.body;

        // Check if email is already registered as a verified user
        const existing_user = await User.findOne({ email });
        if (existing_user) {
            return res.status(400).json({ message: "Email is already registered" });
        }

        // Check if email is already pending verification
        const existing_pending = await PendingUser.findOne({ email });
        if (existing_pending) {
            // Delete old pending registration to allow re-registration
            await PendingUser.deleteOne({ email });
        }

        // Check if phone number is already registered
        const existing_phone = await User.findOne({ phone_number });
        if (existing_phone) {
            return res.status(400).json({ message: "Phone number is already registered" });
        }

        const hashed_password = await bcrypt.hash(password, 10);
        const verification_code = generateVerificationCode();

        // Store in pending users
        await PendingUser.create({
            full_name,
            email,
            password: hashed_password,
            phone_number,
            verification_code
        });

        // Send verification email
        await sendVerificationEmail(email, verification_code, full_name);

        res.status(200).json({
            success: true,
            message: "Verification code sent to email",
            email: email
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
            role: 'pilgrim',
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

        // Send new verification email
        await sendVerificationEmail(email, verification_code, pending_user.full_name);

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
        const { email, password } = req.body;

        // 1. Differentiate by checking User collection (Moderators/Admins)
        let user = await User.findOne({ email });
        let role = user.role || 'pilgrim';

        if (user) {
            if (!(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
        } else {
            // 2. If not found, check Pilgrim collection
            user = await Pilgrim.findOne({ email });
            role = 'pilgrim';

            if (!user) {
                return res.status(401).json({ message: "Invalid credentials" }); // User not found in either
            }

            // Pilgrims might not have passwords yet if migrated from old system
            if (!user.password) {
                return res.status(400).json({ message: "Account not set up for login. Contact moderator." });
            }

            if (!(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
        }

        const token = jwt.sign(
            { id: user._id, role: role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' } // Longer session for app
        );

        res.json({ token, role: role, full_name: user.full_name, user_id: user._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get current user profile
exports.get_profile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id full_name email role phone_number profile_picture created_at');

        if (!user) return res.status(404).json({ message: "User not found" });

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update user profile
exports.update_profile = async (req, res) => {
    try {
        const { full_name, phone_number } = req.body;
        const profile_picture = req.file ? req.file.filename : undefined;

        const updateData = {
            ...(full_name && { full_name }),
            ...(phone_number && { phone_number })
        };

        if (profile_picture) {
            updateData.profile_picture = profile_picture;
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true }
        ).select('_id full_name email role phone_number profile_picture created_at');

        res.json({ message: "Profile updated successfully", user });
    } catch (error) {
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

        const band = await HardwareBand.findOne({ current_user_id: pilgrim_id }).lean();

        pilgrimObj.band_info = band ? {
            serial_number: band.serial_number,
            last_location: band.last_latitude && band.last_longitude ? {
                lat: band.last_latitude,
                lng: band.last_longitude
            } : null,
            last_updated: band.last_updated,
            imei: band.imei,
            battery_percent: band.battery_percent
        } : null;

        res.json(pilgrimObj);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};