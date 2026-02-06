const Group = require('../models/group_model');
const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');
// HardwareBand removed

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
        const pilgrims_with_details = await Promise.all(group.pilgrim_ids.map(async (pilgrim_id) => {
            const pilgrim = await Pilgrim.findById(pilgrim_id)
                .select('full_name national_id email phone_number medical_history age gender current_latitude current_longitude last_location_update battery_percent')
                .lean();

            if (!pilgrim) return null;

            return {
                ...pilgrim,
                // Map new fields to maintain frontend compatibility if needed, or just send as is.
                // For now, let's keep the structure simple or adapt to what frontend expects if we want minimal frontend changes.
                // However, moving forward, the frontend should look at 'current_latitude' etc directly.
                // Let's assume we update frontend to look for these fields.
                location: (pilgrim.current_latitude && pilgrim.current_longitude) ? {
                    lat: pilgrim.current_latitude,
                    lng: pilgrim.current_longitude
                } : null,
                last_updated: pilgrim.last_location_update,
                battery_percent: pilgrim.battery_percent
            };
        }));

        group.pilgrims = pilgrims_with_details.filter(Boolean); // Add enriched pilgrims to group object
        delete group.pilgrim_ids; // Remove raw pilgrim_ids array

        // Remove __v from top-level group object
        delete group.__v;
        // The populated moderator_ids already exclude __v due to 'lean()' and selected fields.

        res.status(200).json(group);

    } catch (error) {
        console.error("Error in get_single_group:", error);
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

        const new_group = await Group.create({
            group_name,
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
            .limit(limitNum);

        const total = await Group.countDocuments(query);

        const enriched_data = await Promise.all(groups.map(async (group) => {
            if (!group) return null;

            const groupObj = group.toObject ? group.toObject() : group;
            const pilgrim_ids = group.pilgrim_ids || [];

            const pilgrims_with_locations = (await Promise.all(pilgrim_ids.map(async (pilgrim_id) => {
                if (!pilgrim_id) return null;

                const pilgrim = await Pilgrim.findById(pilgrim_id)
                    .select('full_name email phone_number national_id medical_history age gender current_latitude current_longitude last_location_update battery_percent');

                if (!pilgrim) return null;

                const pilgrimObj = pilgrim.toObject ? pilgrim.toObject() : pilgrim;

                return {
                    ...pilgrimObj,
                    location: (pilgrimObj.current_latitude && pilgrimObj.current_longitude) ? {
                        lat: pilgrimObj.current_latitude,
                        lng: pilgrimObj.current_longitude
                    } : null,
                    last_updated: pilgrimObj.last_location_update,
                    battery_percent: pilgrimObj.battery_percent
                };
            }))).filter(Boolean); // Remove nulls

            // Rename pilgrim_ids to pilgrims to match docs
            delete groupObj.pilgrim_ids;
            groupObj.pilgrims = pilgrims_with_locations;

            // Polyfill created_at if missing
            groupObj.created_at = groupObj.createdAt || groupObj.created_at || (groupObj._id && groupObj._id.getTimestamp ? groupObj._id.getTimestamp() : new Date(parseInt(groupObj._id.toString().substring(0, 8), 16) * 1000));

            return groupObj;
        }));

        res.json({
            success: true,
            data: enriched_data.filter(Boolean),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error("Error in get_my_groups:", error);
        res.status(500).json({ error: error.message });
    }
};

// Hardware management functions removed (assign_band, unassign_band, get_available_bands)

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
        const { full_name, national_id, phone_number, age, gender, medical_history } = req.body;

        console.log(`[Add Pilgrim] Adding to group ${group_id}:`, { full_name, national_id, phone_number });

        // Build query to check if exists
        const orConditions = [{ national_id }];
        if (phone_number && phone_number.trim() !== '') {
            orConditions.push({ phone_number: phone_number.trim() });
        }

        let pilgrim = await Pilgrim.findOne({ $or: orConditions });

        if (!pilgrim) {
            console.log('[Add Pilgrim] Creating new pilgrim...');

            // Prepare data, excluding empty strings for unique fields
            const pilgrimData = {
                full_name,
                national_id,
                age: age || 30,
                gender: gender || 'male',
                medical_history: medical_history || 'None',
                created_by: req.user.id
            };

            if (phone_number && phone_number.trim() !== '') {
                pilgrimData.phone_number = phone_number.trim();
            }

            pilgrim = await Pilgrim.create(pilgrimData);
        } else {
            console.log('[Add Pilgrim] Found existing pilgrim:', pilgrim._id);
        }

        const updated_group = await Group.findByIdAndUpdate(
            group_id,
            { $addToSet: { pilgrim_ids: pilgrim._id } },
            { new: true }
        ).populate('pilgrim_ids', 'full_name email phone_number national_id age gender location battery_percent last_location_update');

        if (!updated_group) {
            console.error('[Add Pilgrim] Group not found');
            return res.status(404).json({ message: "Group not found" });
        }

        res.json({
            message: "Pilgrim added to group",
            success: true,
            group: {
                _id: updated_group._id,
                group_name: updated_group.group_name,
                pilgrims: updated_group.pilgrim_ids
            }
        });
    } catch (error) {
        console.error('[Add Pilgrim Error]', error);
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
        const Notification = require('../models/notification_model'); // Lazy load to avoid circular deps if any
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
        console.error("Error in remove_moderator:", error);
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
        const Notification = require('../models/notification_model');
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
        console.error("Error in leave_group:", error);
        res.status(500).json({ error: error.message });
    }
};

// Update group details
exports.update_group_details = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { group_name } = req.body;

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
        await group.save();

        const updated_group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .lean();

        // Clean up __v and pilgrim_ids for response to match docs
        delete updated_group.__v;
        // The docs show pilgrim_ids as an array of IDs in the PUT response, so no need to delete or populate details for it

        res.status(200).json({ message: "Group updated successfully", group: updated_group });

    } catch (error) {
        console.error("Error in update_group_details:", error);
        res.status(500).json({ error: error.message });
    }
};