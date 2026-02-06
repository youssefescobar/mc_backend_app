const User = require('../models/user_model');
const ModeratorRequest = require('../models/moderator_request_model');
const Pilgrim = require('../models/pilgrim_model');
const Group = require('../models/group_model');
const HardwareBand = require('../models/hardware_band_model');

// Get all users with pagination
exports.get_all_users = async (req, res) => {
    try {
        const { page = 1, limit = 50, role } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
        const skip = (pageNum - 1) * limitNum;

        let users;
        let total;

        if (role === 'pilgrim') {
            users = await Pilgrim.find({})
                .select('_id full_name email phone_number active created_at')
                .skip(skip)
                .limit(limitNum)
                .lean();
            total = await Pilgrim.countDocuments();
        } else {
            const query = role ? { role } : {};
            users = await User.find(query)
                .select('_id full_name email phone_number role active created_at')
                .skip(skip)
                .limit(limitNum)
                .lean();
            total = await User.countDocuments(query);
        }

        res.json({
            success: true,
            data: users,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all groups with pagination
exports.get_all_groups = async (req, res) => {
    try {
        const { page = 1, limit = 30, search } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 30));
        const skip = (pageNum - 1) * limitNum;

        const query = {};
        if (search) {
            query.group_name = { $regex: search, $options: 'i' };
        }

        const groups = await Group.find(query)
            .populate('moderator_ids', 'full_name email')
            .populate('created_by', 'full_name email')
            .skip(skip)
            .limit(limitNum)
            .lean();

        const total = await Group.countDocuments(query);

        const groupsWithCount = groups.map(group => ({
            ...group,
            pilgrim_count: group.pilgrim_ids ? group.pilgrim_ids.length : 0,
            pilgrims: group.pilgrim_ids, // Alias for frontend compatibility
            created_at: group.createdAt || group.created_at || (group._id && group._id.getTimestamp ? group._id.getTimestamp() : new Date(parseInt(group._id.substring(0, 8), 16) * 1000))
        }));

        res.json({
            success: true,
            data: groupsWithCount,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get system statistics
exports.get_system_stats = async (req, res) => {
    try {
        const total_users_count = await User.countDocuments();
        const pilgrims_count = await Pilgrim.countDocuments();
        const total_users = total_users_count + pilgrims_count;

        const moderators = await User.countDocuments({ role: 'moderator' });
        const admins = await User.countDocuments({ role: 'admin' });

        const active_users_count = await User.countDocuments({ active: true });
        const active_pilgrims_count = await Pilgrim.countDocuments({ active: true });
        const active_users = active_users_count + active_pilgrims_count;

        const inactive_users_count = await User.countDocuments({ active: false });
        const inactive_pilgrims_count = await Pilgrim.countDocuments({ active: false });
        const inactive_users = inactive_users_count + inactive_pilgrims_count;

        const total_groups = await Group.countDocuments();
        const total_bands = await HardwareBand.countDocuments();
        const active_bands = await HardwareBand.countDocuments({ status: 'active' });
        const maintenance_bands = await HardwareBand.countDocuments({ status: 'maintenance' });
        const inactive_bands = await HardwareBand.countDocuments({ status: 'inactive' });
        const bands_assigned = await HardwareBand.countDocuments({ current_user_id: { $ne: null } });

        // Calculate average pilgrims per group
        const groups_with_pilgrims_aggregation = await Group.aggregate([
            {
                $group: {
                    _id: null,
                    avg_pilgrims: { $avg: { $size: '$pilgrim_ids' } }
                }
            }
        ]);
        const avg_pilgrims_per_group = groups_with_pilgrims_aggregation[0]?.avg_pilgrims || 0;

        res.json({
            success: true,
            stats: {
                total_users,
                admins,
                moderators,
                pilgrims: pilgrims_count,
                active_users,
                inactive_users,
                total_groups,
                avg_pilgrims_per_group,
                total_bands,
                active_bands,
                maintenance_bands,
                inactive_bands,
                assigned_bands: bands_assigned,
                unassigned_bands: total_bands - bands_assigned
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Promote user to admin
exports.promote_to_admin = async (req, res) => {
    try {
        const { user_id } = req.body;

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === 'admin') {
            return res.status(400).json({ message: "User is already an admin" });
        }

        user.role = 'admin';
        await user.save();

        const safeUser = user.toObject ? user.toObject() : user;
        if (safeUser.password) delete safeUser.password;

        res.json({ message: `User promoted to admin`, user: safeUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Demote admin to moderator
exports.demote_to_moderator = async (req, res) => {
    try {
        const { user_id } = req.body;

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === 'moderator') {
            return res.status(400).json({ message: "User is already a moderator" });
        }

        user.role = 'moderator';
        await user.save();

        const safeUser = user.toObject ? user.toObject() : user;
        if (safeUser.password) delete safeUser.password;

        res.json({ message: "User demoted to moderator", user: safeUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Demote moderator to pilgrim
exports.demote_to_pilgrim = async (req, res) => {
    try {
        const { user_id } = req.body;

        const user = await User.findById(user_id);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role !== 'moderator') {
            return res.status(400).json({ message: "Only moderators can be demoted to pilgrims" });
        }

        // Create a new pilgrim with the user's data
        const pilgrim = await Pilgrim.create({
            full_name: user.full_name,
            phone_number: user.phone_number,
            email: user.email,
            // any other fields to be transferred
        });

        // Remove the user
        await User.findByIdAndDelete(user_id);

        // Remove them from group moderator lists
        await Group.updateMany(
            { moderator_ids: user_id },
            { $pull: { moderator_ids: user_id } }
        );

        res.json({ message: "User demoted to pilgrim", pilgrim_id: pilgrim._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Deactivate user account
exports.deactivate_user = async (req, res) => {
    try {
        const { user_id } = req.body;

        let user = await User.findById(user_id);
        if (user) {
            user.active = false;
            await user.save();
            const safeUser = user.toObject ? user.toObject() : user;
            if (safeUser.password) delete safeUser.password;
            return res.json({ message: "User deactivated", user: safeUser });
        }

        let pilgrim = await Pilgrim.findById(user_id);
        if (pilgrim) {
            pilgrim.active = false;
            await pilgrim.save();
            return res.json({ message: "Pilgrim deactivated", pilgrim });
        }

        return res.status(404).json({ message: "User or pilgrim not found" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Activate user account
exports.activate_user = async (req, res) => {
    try {
        const { user_id } = req.body;

        let user = await User.findById(user_id);
        if (user) {
            user.active = true;
            await user.save();
            const safeUser = user.toObject ? user.toObject() : user;
            if (safeUser.password) delete safeUser.password;
            return res.json({ message: "User activated", user: safeUser });
        }

        let pilgrim = await Pilgrim.findById(user_id);
        if (pilgrim) {
            pilgrim.active = true;
            await pilgrim.save();
            return res.json({ message: "Pilgrim activated", pilgrim });
        }

        return res.status(404).json({ message: "User or pilgrim not found" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Permanently delete a user (admin only)
exports.delete_user_permanently = async (req, res) => {
    try {
        const { user_id } = req.params;

        let deleted_user = await User.findOneAndDelete({ _id: user_id });
        let message = `User with ID ${user_id} has been permanently deleted.`;

        if (!deleted_user) {
            deleted_user = await Pilgrim.findOneAndDelete({ _id: user_id });
            message = `Pilgrim with ID ${user_id} has been permanently deleted.`;
        }

        if (!deleted_user) {
            return res.status(404).json({ message: "User or pilgrim not found" });
        }

        // Also remove the user from any groups they might be moderating or be a pilgrim in
        await Group.updateMany(
            { $or: [{ moderator_ids: user_id }, { pilgrim_ids: user_id }] },
            { $pull: { moderator_ids: user_id, pilgrim_ids: user_id } }
        );

        // Also unassign any hardware bands from this user
        await HardwareBand.updateMany(
            { current_user_id: user_id },
            { $set: { current_user_id: null, status: 'inactive' } } // Set band to inactive if user is deleted
        );

        res.status(200).json({ message });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Permanently delete a group (admin only)
exports.delete_group_by_id = async (req, res) => {
    try {
        const { group_id } = req.params;

        const deleted_group = await Group.findOneAndDelete({ _id: group_id });

        if (!deleted_group) {
            return res.status(404).json({ message: "Group not found" });
        }

        res.status(200).json({ message: `Group with ID ${group_id} has been permanently deleted.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Assign bands to a group
exports.assign_bands_to_group = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { band_ids } = req.body;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        // Validate that provided band IDs exist
        const bands = await HardwareBand.find({ _id: { $in: band_ids } }).lean();
        if (bands.length !== band_ids.length) {
            const existingIds = bands.map(b => b._id.toString());
            const missing = band_ids.filter(id => !existingIds.includes(id.toString()));
            return res.status(404).json({ message: 'Some bands not found', missing });
        }

        // Check if any of these bands are currently assigned to a USER
        const assignedToUser = bands.filter(b => b.current_user_id != null);
        if (assignedToUser.length > 0) {
            const assignedSerials = assignedToUser.map(b => b.serial_number).join(', ');
            return res.status(400).json({
                message: `Cannot assign bands. The following bands are currently assigned to users: ${assignedSerials}`
            });
        }

        // Check if any of these bands are already assigned to ANY other group
        const conflictingGroup = await Group.findOne({
            available_band_ids: { $in: band_ids },
            _id: { $ne: group_id } // Exclude the current group
        });

        if (conflictingGroup) {
            return res.status(400).json({
                message: `One or more bands are already assigned to group: ${conflictingGroup.group_name}`
            });
        }

        // Add the new band IDs to the group's available bands
        await Group.findByIdAndUpdate(
            group_id,
            { $addToSet: { available_band_ids: { $each: band_ids } } }
        );

        // Fetch the updated group with populated fields (don't use .lean() with populate)
        const updated_group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .populate('available_band_ids', 'serial_number status imei');

        console.log('Updated group:', updated_group);

        res.json({
            message: "Bands assigned to group successfully",
            group: updated_group
        });
    } catch (error) {
        console.error('Error in assign_bands_to_group:', error);
        res.status(500).json({ error: error.message });
    }
};

// Unassign bands from a group
exports.unassign_bands_from_group = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { band_ids } = req.body;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        // Remove the band IDs from the group's available bands
        await Group.findByIdAndUpdate(
            group_id,
            { $pullAll: { available_band_ids: band_ids } }
        );

        // Fetch the updated group with populated fields (don't use .lean() with populate)
        const updated_group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .populate('available_band_ids', 'serial_number status imei');

        console.log('Updated group after unassign:', updated_group);

        res.json({
            message: "Bands unassigned from group successfully",
            group: updated_group
        });
    } catch (error) {
        console.error('Error in unassign_bands_from_group:', error);
        res.status(500).json({ error: error.message });
    }
};

// Submit a request to become a moderator
exports.submit_moderator_request = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Check if user is already a moderator or admin
        const user = await User.findById(user_id);
        if (['moderator', 'admin'].includes(user.role)) {
            return res.status(400).json({ message: "You are already a moderator or admin" });
        }

        // Check if a pending request already exists
        const existing_request = await ModeratorRequest.findOne({ user_id, status: 'pending' });
        if (existing_request) {
            return res.status(400).json({ message: "You already have a pending request" });
        }

        await ModeratorRequest.create({ user_id });

        res.status(201).json({ message: "Request submitted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all pending requests (Admin only)
exports.get_pending_requests = async (req, res) => {
    try {
        const requests = await ModeratorRequest.find({ status: 'pending' })
            .populate('user_id', 'full_name email phone_number profile_picture')
            .sort({ created_at: -1 });

        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Approve a moderator request
exports.approve_moderator_request = async (req, res) => {
    try {
        const { request_id } = req.params;

        const request = await ModeratorRequest.findById(request_id);
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: "Request is already processed" });
        }

        // Update request status
        request.status = 'approved';
        request.updated_at = Date.now();
        await request.save();

        // Update user role
        await User.findByIdAndUpdate(request.user_id, { role: 'moderator' });

        res.json({ message: "Request approved. User is now a moderator." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Reject a moderator request
exports.reject_moderator_request = async (req, res) => {
    try {
        const { request_id } = req.params;

        const request = await ModeratorRequest.findById(request_id);
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: "Request is already processed" });
        }

        request.status = 'rejected';
        request.updated_at = Date.now();
        await request.save();

        res.json({ message: "Request rejected" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
