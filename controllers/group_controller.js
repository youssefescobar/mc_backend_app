const Group = require('../models/group_model');
const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');
const SuggestedArea = require('../models/suggested_area_model');
const Notification = require('../models/notification_model');
const QRCode = require('qrcode');
const { logger } = require('../config/logger');

// Get a single group by ID (moderator/admin only)
exports.get_single_group = async (req, res) => {
    try {
        const { group_id } = req.params;

        const group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .lean(); // Use lean for easier object manipulation

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        // Check if user is admin or a moderator of this group
        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod._id.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return res.status(403).json({ message: "Not authorized to view this group" });
        }

        // Enrich pilgrims with their details (Location now directly on Pilgrim)
        const pilgrim_ids = group.pilgrim_ids || [];

        // Optimize: Fetch all pilgrims in one query
        const pilgrims = await Pilgrim.find({ _id: { $in: pilgrim_ids } })
            .select('full_name national_id email phone_number medical_history age gender current_latitude current_longitude last_location_update battery_percent active is_online last_active_at')
            .lean();

        const pilgrims_with_details = pilgrims.map(pilgrim => {
            return {
                ...pilgrim,
                location: (pilgrim.current_latitude && pilgrim.current_longitude) ? {
                    lat: pilgrim.current_latitude,
                    lng: pilgrim.current_longitude
                } : null,
                last_updated: pilgrim.last_location_update,
                battery_percent: pilgrim.battery_percent,
                active: pilgrim.is_online, // Map is_online to active for frontend compatibility
                last_active_at: pilgrim.last_active_at
            };
        });

        group.pilgrims = pilgrims_with_details;
        delete group.pilgrim_ids; // Remove raw pilgrim_ids array

        // Remove __v from top-level group object
        delete group.__v;

        res.status(200).json(group);

    } catch (error) {
        logger.error(`Error in get_single_group: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// 1. Create a group and assign the moderator
exports.create_group = async (req, res) => {
    try {
        const { group_name } = req.body;

        // Check if this moderator already has a group with the same name
        const existing = await Group.findOne({
            group_name,
            moderator_ids: req.user.id
        });

        if (existing) {
            return res.status(400).json({ message: "You already have a group with this name" });
        }

        // Generate unique 6-character code
        // Simple implementation: Random 6 alphanumeric uppercase
        let group_code;
        let isUnique = false;
        while (!isUnique) {
            group_code = Math.random().toString(36).substring(2, 8).toUpperCase();
            const check = await Group.findOne({ group_code });
            if (!check) isUnique = true;
        }

        const new_group = await Group.create({
            group_name,
            group_code,
            moderator_ids: [req.user.id], // The creator is the first moderator
            created_by: req.user.id
        });

        const group_obj = new_group.toObject();
        delete group_obj.__v;

        res.status(201).json(group_obj);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Generate QR Code for a group
exports.generate_group_qr = async (req, res) => {
    try {
        const { group_id } = req.params;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        // Check if user is admin or a moderator of this group
        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return res.status(403).json({ message: "Not authorized to access this group" });
        }

        // Generate QR code as base64 data URL
        const qrCodeDataURL = await QRCode.toDataURL(group.group_code, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            width: 300,
            margin: 2
        });

        res.json({
            group_code: group.group_code,
            qr_code: qrCodeDataURL
        });

    } catch (error) {
        logger.error(`Error generating QR code: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// 1.5 Join Group via Code
exports.join_group = async (req, res) => {
    try {
        const { group_code } = req.body;

        if (!group_code) {
            return res.status(400).json({ message: "Group code is required" });
        }

        const group = await Group.findOne({ group_code });
        if (!group) {
            return res.status(404).json({ message: "Invalid group code" });
        }

        // Only pilgrims can join groups via code
        if (req.user.role !== 'pilgrim') {
            return res.status(403).json({ message: "Only pilgrims can join groups via code. Moderators must be invited." });
        }

        // Check if already in group
        const is_member = group.pilgrim_ids.some(id => id.toString() === req.user.id) ||
            group.moderator_ids.some(id => id.toString() === req.user.id);

        if (is_member) {
            return res.status(400).json({ message: "You are already a member of this group" });
        }

        // Add to pilgrim_ids
        group.pilgrim_ids.push(req.user.id);
        await group.save();

        res.json({
            success: true,
            message: `Successfully joined group: ${group.group_name}`,
            group: {
                _id: group._id,
                group_name: group.group_name,
                role: 'member'
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Dashboard: Get groups I belong to + Pilgrim info + Locations
exports.get_my_groups = async (req, res) => {
    try {
        const { page = 1, limit = 25 } = req.query || {};

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 25)); // Max 50 per page
        const skip = (pageNum - 1) * limitNum;

        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "User not authenticated" });
        }

        const query = { moderator_ids: req.user.id };
        const groups = await Group.find(query)
            .populate('moderator_ids', 'full_name email')
            .skip(skip)
            .limit(limitNum)
            .lean(); // Use lean for better performance

        const total = await Group.countDocuments(query);

        // Collect all unique pilgrim IDs across all fetched groups
        const allPilgrimIds = new Set();
        groups.forEach(group => {
            if (group.pilgrim_ids && Array.isArray(group.pilgrim_ids)) {
                group.pilgrim_ids.forEach(id => allPilgrimIds.add(id.toString()));
            }
        });

        // Fetch all pilgrims in one query if there are any
        let pilgrimsMap = {};
        if (allPilgrimIds.size > 0) {
            const pilgrims = await Pilgrim.find({ _id: { $in: Array.from(allPilgrimIds) } })
                .select('full_name email phone_number national_id medical_history age gender current_latitude current_longitude last_location_update battery_percent active is_online last_active_at')
                .lean();

            pilgrims.forEach(p => {
                pilgrimsMap[p._id.toString()] = p;
            });
        }

        // Enrich groups with pilgrim data from map
        const enriched_data = groups.map(group => {
            const pilgrim_ids = group.pilgrim_ids || [];

            const pilgrims_with_locations = pilgrim_ids.map(id => {
                const pilgrim = pilgrimsMap[id.toString()];
                if (!pilgrim) return null;

                return {
                    ...pilgrim,
                    location: (pilgrim.current_latitude && pilgrim.current_longitude) ? {
                        lat: pilgrim.current_latitude,
                        lng: pilgrim.current_longitude
                    } : null,
                    last_updated: pilgrim.last_location_update,
                    battery_percent: pilgrim.battery_percent,
                    active: pilgrim.is_online, // Map is_online to active for frontend compatibility
                    last_active_at: pilgrim.last_active_at
                };
            }).filter(Boolean);

            // Rename pilgrim_ids to pilgrims to match docs
            delete group.pilgrim_ids;
            group.pilgrims = pilgrims_with_locations;

            // Polyfill created_at if missing
            group.created_at = group.createdAt || group.created_at || (group._id && group._id.getTimestamp ? group._id.getTimestamp() : new Date());

            return group;
        });

        res.json({
            success: true,
            data: enriched_data,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        logger.error(`Error in get_my_groups: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// 4. Send Message to Group (for later Voice processing)
exports.send_group_alert = async (req, res) => {
    try {
        const { group_id, message_text } = req.body;

        // Validate group exists
        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        // Logic for Option 3 hardware: This text would be pushed to the hardware SDK
        // For now, we return a success status
        res.json({
            status: "queued",
            message: `Alert "${message_text}" sent to group ${group_id}`,
            recipients: group.pilgrim_ids.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4.5 Send Message to Individual Pilgrim
exports.send_individual_alert = async (req, res) => {
    try {
        const { user_id, message_text } = req.body;

        // Validate pilgrim exists
        const pilgrim = await Pilgrim.findById(user_id);
        if (!pilgrim) {
            return res.status(404).json({ message: "Pilgrim not found" });
        }

        // Get the band assigned to this pilgrim
        // Legacy check removed. Pilgrim is the target directly.
        // const band = await HardwareBand.findOne({ current_user_id: user_id });
        // if (!band) ...

        // Logic for sending alert to specific wristband
        res.json({
            status: "queued",
            message: `Alert "${message_text}" sent to pilgrim ${pilgrim.full_name}`
            // band_serial: band.serial_number
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 5. Add pilgrim to group (Create if not exists)
exports.add_pilgrim_to_group = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { identifier } = req.body;

        if (!identifier || identifier.trim() === '') {
            return res.status(400).json({ message: "Email, phone number, or national ID is required." });
        }

        const existing_pilgrim = await Pilgrim.findOne({
            $or: [
                { email: identifier.trim().toLowerCase() },
                { phone_number: identifier.trim() },
                { national_id: identifier.trim() }
            ]
        });

        if (!existing_pilgrim) {
            return res.status(404).json({ message: "No registered pilgrim found with that email, phone number, or national ID." });
        }

        const updated_group = await Group.findByIdAndUpdate(
            group_id,
            { $addToSet: { pilgrim_ids: existing_pilgrim._id } },
            { new: true }
        ).populate('pilgrim_ids', 'full_name email phone_number national_id age gender location battery_percent last_location_update');

        if (!updated_group) {
            return res.status(404).json({ message: "Group not found" });
        }

        return res.json({
            message: "Pilgrim added to group",
            success: true,
            group: {
                _id: updated_group._id,
                group_name: updated_group.group_name,
                pilgrims: updated_group.pilgrim_ids
            }
        });
    } catch (error) {
        logger.error(`[Add Pilgrim Error]: ${error.message}`);
        if (error.code === 11000) {
            return res.status(400).json({ message: "Pilgrim with this National ID or Phone Number already exists." });
        }
        res.status(500).json({ error: error.message });
    }
};

// 6. Remove pilgrim from group
exports.remove_pilgrim_from_group = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { user_id } = req.body;

        const updated_group = await Group.findByIdAndUpdate(
            group_id,
            { $pull: { pilgrim_ids: user_id } },
            { new: true }
        );

        if (!updated_group) return res.status(404).json({ message: "Group not found" });

        res.json({
            message: "Pilgrim removed from group",
            group: {
                _id: updated_group._id,
                group_name: updated_group.group_name,
                pilgrim_ids: updated_group.pilgrim_ids
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 7. Delete a group (unassigns all pilgrims automatically)
exports.delete_group = async (req, res) => {
    try {
        const { group_id } = req.params;

        // Verify the user is a moderator of this group
        const group = await Group.findById(group_id);
        if (!group) return res.status(404).json({ message: "Group not found" });

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator) {
            return res.status(403).json({ message: "Only group moderators can delete the group" });
        }

        // Delete the group (pilgrims are automatically unassigned)
        await Group.findByIdAndDelete(group_id);

        res.json({ message: "Group deleted successfully", group_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 8. Remove Moderator (Creator only)
exports.remove_moderator = async (req, res) => {
    try {
        const { group_id, user_id } = req.params; // user_id of the moderator to remove

        const group = await Group.findById(group_id);
        if (!group) return res.status(404).json({ message: "Group not found" });

        // Only creator can remove moderators
        if (group.created_by.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: "Only the group creator can remove moderators" });
        }

        // Cannot remove self
        if (user_id === req.user.id.toString()) {
            return res.status(400).json({ message: "You cannot remove yourself. Use 'Delete Group' instead." });
        }

        // Check if user is actually a moderator
        if (!group.moderator_ids.some(id => id.toString() === user_id)) {
            return res.status(400).json({ message: "User is not a moderator of this group" });
        }

        // Remove from moderators list
        await Group.findByIdAndUpdate(group_id, {
            $pull: { moderator_ids: user_id }
        });

        // Notify the removed moderator
        await Notification.create({
            user_id: user_id,
            type: 'moderator_removed',
            title: 'Removed from Group',
            message: `You have been removed from the moderators of "${group.group_name}"`,
            data: {
                group_id: group._id,
                group_name: group.group_name
            }
        });

        res.json({ message: "Moderator removed successfully" });
    } catch (error) {
        logger.error(`Error in remove_moderator: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// 9. Leave Group (Invited moderators only)
exports.leave_group = async (req, res) => {
    try {
        const { group_id } = req.params;

        const group = await Group.findById(group_id);
        if (!group) return res.status(404).json({ message: "Group not found" });

        // Creator cannot leave
        if (group.created_by.toString() === req.user.id.toString()) {
            return res.status(400).json({ message: "Group creator cannot leave the group. You must delete the group." });
        }

        // Check if user is a moderator
        if (!group.moderator_ids.some(id => id.toString() === req.user.id.toString())) {
            return res.status(400).json({ message: "You are not a moderator of this group" });
        }

        // Remove from moderators list
        await Group.findByIdAndUpdate(group_id, {
            $pull: { moderator_ids: req.user.id }
        });

        // Notify the creator
        await Notification.create({
            user_id: group.created_by,
            type: 'moderator_left',
            title: 'Moderator Left Group',
            message: `${req.user.full_name} has left the group "${group.group_name}"`,
            data: {
                group_id: group._id,
                group_name: group.group_name
            }
        });

        res.json({ message: "You have left the group successfully" });
    } catch (error) {
        logger.error(`Error in leave_group: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Update group details
exports.update_group_details = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { group_name, allow_pilgrim_navigation } = req.body;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return res.status(403).json({ message: "Not authorized to update this group" });
        }

        // Check if new group name already exists for this moderator (only if moderator is updating)
        if (group_name && !is_admin) {
            const existing_group_with_name = await Group.findOne({
                group_name,
                moderator_ids: req.user.id,
                _id: { $ne: group_id } // Exclude current group
            });
            if (existing_group_with_name) {
                return res.status(400).json({ message: "You already have a group with this name" });
            }
        }

        group.group_name = group_name || group.group_name;
        if (typeof allow_pilgrim_navigation === 'boolean') {
            group.allow_pilgrim_navigation = allow_pilgrim_navigation;
        }
        await group.save();

        const updated_group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .lean();

        // Clean up __v and pilgrim_ids for response to match docs
        delete updated_group.__v;
        // The docs show pilgrim_ids as an array of IDs in the PUT response, so no need to delete or populate details for it

        res.status(200).json({ message: "Group updated successfully", group: updated_group });

    } catch (error) {
        logger.error(`Error in update_group_details: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// ============ SUGGESTED AREAS ============

// Add a suggested area to a group
exports.add_suggested_area = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { name, description, latitude, longitude, area_type } = req.body;
        const type = area_type || 'suggestion';

        if (!name || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ message: "Name, latitude, and longitude are required" });
        }

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return res.status(403).json({ message: "Not authorized" });
        }

        // Meetpoint constraint: only one active meetpoint per group
        if (type === 'meetpoint') {
            const existing = await SuggestedArea.findOne({ group_id, area_type: 'meetpoint', active: true });
            if (existing) {
                return res.status(409).json({ message: "A meetpoint already exists. Delete the current one before adding a new one." });
            }
        }

        const area = await SuggestedArea.create({
            group_id,
            created_by: req.user.id,
            name: name.trim(),
            description: (description || '').trim(),
            area_type: type,
            latitude,
            longitude
        });

        await area.populate('created_by', 'full_name');

        // --- Socket.io real-time broadcast ---
        const io = req.app.get('socketio');
        if (io) {
            io.to(`group_${group_id}`).emit('area_added', area);
        }

        // --- Create notifications for all pilgrims in the group ---
        const moderatorName = req.user.full_name || 'Moderator';
        const notifType = type === 'meetpoint' ? 'meetpoint' : 'suggested_area';
        const notifTitle = type === 'meetpoint'
            ? `Urgent Meetpoint: ${name.trim()}`
            : `Suggested Area: ${name.trim()}`;
        const notifMessage = type === 'meetpoint'
            ? `${moderatorName} set an urgent meetpoint. Navigate there now!`
            : `${moderatorName} suggested an area for you to visit.`;

        // Get pilgrim IDs (pilgrims ARE the direct users — use _id for notification)
        const pilgrimDocs = await Pilgrim.find(
            { _id: { $in: group.pilgrim_ids } },
            '_id'
        ).lean();

        const notifications = pilgrimDocs.map(p => ({
                user_id: p._id,
                type: notifType,
                title: notifTitle,
                message: notifMessage,
                data: {
                    group_id,
                    group_name: group.group_name,
                    area_id: area._id,
                    location: { lat: latitude, lng: longitude }
                }
            }));

        if (notifications.length > 0) {
            await Notification.insertMany(notifications);
            // Nudge each pilgrim's socket so their badge refreshes
            if (io) {
                for (const p of pilgrimDocs) {
                    io.to(`user_${p._id}`).emit('notification_refresh');
                }
            }
        }

        // --- If meetpoint, also post it as an urgent message in the group chat ---
        if (type === 'meetpoint') {
            const Message = require('../models/message_model');
            const meetpointMsg = await Message.create({
                group_id,
                sender_id: req.user.id,
                sender_model: 'User',
                type: 'meetpoint',
                content: description ? description.trim() : '',
                is_urgent: true,
                meetpoint_data: {
                    area_id: area._id,
                    name: name.trim(),
                    latitude,
                    longitude
                }
            });
            await meetpointMsg.populate('sender_id', 'full_name profile_picture role');
            if (io) {
                io.to(`group_${group_id}`).emit('new_message', meetpointMsg);
            }
        }

        res.status(201).json({ success: true, area });
    } catch (error) {
        logger.error(`Error in add_suggested_area: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Get all active suggested areas for a group
exports.get_suggested_areas = async (req, res) => {
    try {
        const { group_id } = req.params;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const areas = await SuggestedArea.find({ group_id, active: true })
            .populate('created_by', 'full_name')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, areas });
    } catch (error) {
        logger.error(`Error in get_suggested_areas: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

// Delete (soft) a suggested area
exports.delete_suggested_area = async (req, res) => {
    try {
        const { group_id, area_id } = req.params;

        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return res.status(403).json({ message: "Not authorized" });
        }

        const area = await SuggestedArea.findOneAndUpdate(
            { _id: area_id, group_id, active: true },
            { active: false },
            { new: true }
        );

        if (!area) {
            return res.status(404).json({ message: "Suggested area not found" });
        }

        // --- Socket.io real-time broadcast ---
        const io = req.app.get('socketio');
        if (io) {
            io.to(`group_${group_id}`).emit('area_deleted', {
                area_id,
                group_id,
                area_type: area.area_type
            });
        }

        res.json({ success: true, message: "Suggested area removed" });
    } catch (error) {
        logger.error(`Error in delete_suggested_area: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};