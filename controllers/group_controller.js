const Group = require('../models/group_model');
const User = require('../models/user_model');
const Hotel = require('../models/hotel_model');
const Bus = require('../models/bus_model');
const SuggestedArea = require('../models/suggested_area_model');
const Notification = require('../models/notification_model');
const Message = require('../models/message_model');
const QRCode = require('qrcode');
const mongoose = require('mongoose');
const { logger } = require('../config/logger');
const { sendSuccess, sendError, sendServerError } = require('../utils/response_helpers');

const toObjectId = (value) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

/**
 * scheduleMeetpointNotifications
 * Schedules both the "X min before" reminder and the "At time" arrival alert.
 */
async function scheduleMeetpointNotifications(area, group, userId) {
    const Reminder = require('../models/reminder_model');
    const scheduler = require('../services/reminderScheduler');

    // 1. Cancel and delete any existing reminders for this area
    if (area.reminder_ids && area.reminder_ids.length > 0) {
        for (const rId of area.reminder_ids) {
            scheduler.cancel(rId);
        }
        await Reminder.deleteMany({ _id: { $in: area.reminder_ids } });
        area.reminder_ids = [];
    }
    // Also defensive check for any reminders that might not be in the array but link to this area
    const strayReminders = await Reminder.find({ related_area_id: area._id }).select('_id');
    if (strayReminders.length > 0) {
        const strayIds = strayReminders.map(r => r._id);
        for (const rId of strayIds) scheduler.cancel(rId);
        await Reminder.deleteMany({ _id: { $in: strayIds } });
    }

    if (area.area_type !== 'meetpoint' || !area.meetpoint_time) return [];

    const newReminderIds = [];
    const now = new Date();
    const meetTime = new Date(area.meetpoint_time);

    // 2. Arrival Notification (Exactly at scheduled time) - Urgent
    if (meetTime > now) {
        const arrival = await Reminder.create({
            created_by: userId,
            group_ids: [group._id],
            target_type: 'group',
            title: 'Time to Meet! 📍',
            text: `Head to ${area.name} now — your meetpoint has started.`,
            scheduled_at: meetTime,
            is_urgent: true,
            related_area_id: area._id,
            status: 'pending'
        });
        scheduler.add(arrival);
        newReminderIds.push(arrival._id);
    }

    // 3. Reminder Notification (X minutes before) - Standard
    if (area.reminder_minutes > 0) {
        const reminderTime = new Date(meetTime.getTime() - (area.reminder_minutes * 60000));
        if (reminderTime > now) {
            const reminder = await Reminder.create({
                created_by: userId,
                group_ids: [group._id],
                target_type: 'group',
                title: 'Meetpoint Reminder',
                text: `You have a meetpoint at ${area.name} in ${area.reminder_minutes} minutes.`,
                scheduled_at: reminderTime,
                is_urgent: false,
                related_area_id: area._id,
                status: 'pending'
            });
            scheduler.add(reminder);
            newReminderIds.push(reminder._id);
        }
    }

    // Update the area with new IDs
    area.reminder_ids = newReminderIds;
    await area.save();
    return newReminderIds;
}

const normalizeString = (value) => String(value || '').trim();

// Get a single group by ID (moderator/admin only)
exports.get_single_group = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        const group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .populate('assigned_hotel_ids', 'name city rooms')
            .populate('assigned_bus_ids', 'bus_number destination departure_time driver_name')
            .lean(); // Use lean for easier object manipulation

        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        // Check if user is admin or a moderator of this group
        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod._id.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return sendError(res, 403, 'Not authorized to view this group');
        }

        // Enrich pilgrims with their details (Location now directly on User)
        const pilgrim_ids = group.pilgrim_ids || [];

        // Optimize: Fetch all pilgrims in one query
        const pilgrims = await User.find({ _id: { $in: pilgrim_ids }, user_type: 'pilgrim' })
            .select('full_name national_id email phone_number medical_history age gender ethnicity hotel_name room_number bus_info visa current_latitude current_longitude last_location_update battery_percent active is_online last_active_at')
            .lean();

        const pilgrims_with_details = pilgrims.map(pilgrim => {
            const lat = Number(pilgrim.current_latitude);
            const lng = Number(pilgrim.current_longitude);
            const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
            return {
                ...pilgrim,
                location: hasLocation ? {
                    lat,
                    lng
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

        sendSuccess(res, 200, null, group);

    } catch (error) {
        sendServerError(res, logger, 'Get single group error', error);
    }
};

// 1. Create a group and assign the moderator
exports.create_group = async (req, res) => {
    try {
        const group_name = normalizeString(req.body.group_name);
        const { check_in_date, check_out_date } = req.body;
        const user_id = toObjectId(req.user.id);
        if (!group_name || !user_id) return sendError(res, 400, 'Invalid request payload');

        // Check if this moderator already has a group with the same name
        const existing = await Group.findOne({
            group_name,
            moderator_ids: user_id
        });

        if (existing) {
            return sendError(res, 400, 'You already have a group with this name');
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
            check_in_date,
            check_out_date,
            moderator_ids: [user_id], // The creator is the first moderator
            created_by: user_id
        });

        const group_obj = new_group.toObject();
        delete group_obj.__v;

        sendSuccess(res, 201, 'Group created successfully', group_obj);
    } catch (error) {
        sendServerError(res, logger, 'Create group error', error);
    }
};

// Generate QR Code for a group
exports.generate_group_qr = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        // Check if user is admin or a moderator of this group
        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return sendError(res, 403, 'Not authorized to access this group');
        }

        // Generate QR code as base64 data URL
        const qrCodeDataURL = await QRCode.toDataURL(group.group_code, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            width: 300,
            margin: 2
        });

        sendSuccess(res, 200, 'QR code generated successfully', {
            group_code: group.group_code,
            qr_code: qrCodeDataURL
        });

    } catch (error) {
        sendServerError(res, logger, 'Generate QR code error', error);
    }
};

// 1.5 Join Group via Code
exports.join_group = async (req, res) => {
    try {
        const group_code = normalizeString(req.body.group_code).toUpperCase();
        const user_id = toObjectId(req.user.id);

        if (!group_code || !user_id) {
            return sendError(res, 400, 'Group code is required');
        }

        const group = await Group.findOne({ group_code });
        if (!group) {
            return sendError(res, 404, 'Invalid group code');
        }

        // Only pilgrims can join groups via code
        if (req.user.role !== 'pilgrim') {
            return sendError(res, 403, 'Only pilgrims can join groups via code. Moderators must be invited.');
        }

        // Check if already in group
        const is_member = group.pilgrim_ids.some(id => id.toString() === user_id.toString()) ||
            group.moderator_ids.some(id => id.toString() === user_id.toString());

        if (is_member) {
            return sendError(res, 400, 'You are already a member of this group');
        }

        // Add to pilgrim_ids
        group.pilgrim_ids.push(user_id);
        await group.save();

        sendSuccess(res, 200, `Successfully joined group: ${group.group_name}`, {
            group: {
                _id: group._id,
                group_name: group.group_name,
                role: 'member'
            }
        });

    } catch (error) {
        sendServerError(res, logger, 'Join group error', error);
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
            return sendError(res, 401, 'User not authenticated');
        }

        const user_id = toObjectId(req.user.id);
        if (!user_id) return sendError(res, 400, 'Invalid user identifier');

        const query = { moderator_ids: user_id };
        const groups = await Group.find(query)
            .populate('moderator_ids', 'full_name email')
            .populate('assigned_hotel_ids', 'name city rooms')
            .populate('assigned_bus_ids', 'bus_number destination departure_time driver_name')
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
            const pilgrims = await User.find({ _id: { $in: Array.from(allPilgrimIds) }, user_type: 'pilgrim' })
                .select('full_name email phone_number national_id medical_history age gender ethnicity hotel_name room_number bus_info visa current_latitude current_longitude last_location_update battery_percent active is_online last_active_at')
                .lean();

            pilgrims.forEach(p => {
                pilgrimsMap[p._id.toString()] = p;
            });
        }

        // Aggregate unread messages for this user grouped by group_id
        const group_ids = groups.map(g => g._id);
        const unreadCounts = await Message.aggregate([
            {
                $match: {
                    group_id: { $in: group_ids },
                    $or: [{ recipient_id: null }, { recipient_id: user_id }],
                    read_by: { $ne: user_id }
                }
            },
            {
                $group: {
                    _id: "$group_id",
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const unreadMap = {};
        unreadCounts.forEach(c => unreadMap[c._id.toString()] = c.count);

        // Enrich groups with pilgrim data from map
        const enriched_data = groups.map(group => {
            const pilgrim_ids = group.pilgrim_ids || [];

            const pilgrims_with_locations = pilgrim_ids.map(id => {
                const pilgrim = pilgrimsMap[id.toString()];
                if (!pilgrim) return null;

                const lat = Number(pilgrim.current_latitude);
                const lng = Number(pilgrim.current_longitude);
                const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

                return {
                    ...pilgrim,
                    location: hasLocation ? {
                        lat,
                        lng
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

            group.unread_count = unreadMap[group._id.toString()] || 0;

            return group;
        });

        sendSuccess(res, 200, null, {
            data: enriched_data,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        sendServerError(res, logger, 'Get my groups error', error);
    }
};

// 3.5 Get all pilgrims created by this moderator or co-moderators, with current group info
exports.get_my_pilgrims = async (req, res) => {
    try {
        const user_id = toObjectId(req.user.id);
        if (!user_id) return sendError(res, 400, 'Invalid user identifier');

        // Collect all moderator IDs across all groups this moderator belongs to
        const my_groups = await Group.find({ moderator_ids: user_id }).lean();
        const all_moderator_ids = new Set([user_id.toString()]);
        my_groups.forEach(g => {
            g.moderator_ids.forEach(mid => all_moderator_ids.add(mid.toString()));
        });

        // Query filter: all pilgrims created by any of these moderators
        const filter = req.user.role === 'admin'
            ? { user_type: 'pilgrim' }
            : { user_type: 'pilgrim', created_by: { $in: Array.from(all_moderator_ids) } };

        const pilgrims = await User.find(filter)
            .select('full_name phone_number national_id age language ethnicity is_online created_at limbo_reason limbo_group_name medical_history room_number bus_info hotel_name visa')
            .lean();

        if (pilgrims.length === 0) {
            return sendSuccess(res, 200, null, { data: [] });
        }

        // For each pilgrim, find their current group assignment (if any)
        const pilgrim_ids = pilgrims.map(p => p._id);
        const groups_with_these_pilgrims = await Group.find({ pilgrim_ids: { $in: pilgrim_ids } })
            .select('_id group_name pilgrim_ids')
            .lean();

        // Build a map: pilgrim_id -> { group_id, group_name }
        const pilgrim_group_map = {};
        groups_with_these_pilgrims.forEach(g => {
            g.pilgrim_ids.forEach(pid => {
                pilgrim_group_map[pid.toString()] = {
                    group_id: g._id.toString(),
                    group_name: g.group_name
                };
            });
        });

        // Enrich pilgrims with group info
        const enriched = pilgrims.map(p => ({
            ...p,
            current_group: pilgrim_group_map[p._id.toString()] || null
        }));

        sendSuccess(res, 200, null, { data: enriched });
    } catch (error) {
        sendServerError(res, logger, 'Get my pilgrims error', error);
    }
};

// 4. Send Message to Group (for later Voice processing)
exports.send_group_alert = async (req, res) => {
    try {
        const group_id = toObjectId(req.body.group_id);
        const message_text = normalizeString(req.body.message_text);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        // Validate group exists
        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        // Logic for Option 3 hardware: This text would be pushed to the hardware SDK
        // For now, we return a success status
        sendSuccess(res, 200, `Alert "${message_text}" sent to group ${group_id}`, {
            status: 'queued',
            recipients: group.pilgrim_ids.length
        });
    } catch (error) {
        sendServerError(res, logger, 'Send group alert error', error);
    }
};

// 4.5 Send Message to Individual Pilgrim
exports.send_individual_alert = async (req, res) => {
    try {
        const user_id = toObjectId(req.body.user_id);
        const message_text = normalizeString(req.body.message_text);
        if (!user_id) return sendError(res, 400, 'Invalid user identifier');

        // Validate pilgrim exists
        const pilgrim = await User.findById(user_id);
        if (!pilgrim) {
            return sendError(res, 404, 'Pilgrim not found');
        }

        // Get the band assigned to this pilgrim
        // Legacy check removed. Pilgrim is the target directly.
        // const band = await HardwareBand.findOne({ current_user_id: user_id });
        // if (!band) ...

        // Logic for sending alert to specific wristband
        sendSuccess(res, 200, `Alert "${message_text}" sent to pilgrim ${pilgrim.full_name}`, {
            status: 'queued'
        });
    } catch (error) {
        sendServerError(res, logger, 'Send individual alert error', error);
    }
};

// 5. Add/Transfer existing pilgrim to group
exports.add_pilgrim_to_group = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const identifier = normalizeString(req.body.identifier);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        if (!identifier) {
            return sendError(res, 400, 'Email, phone number, national ID, or name is required');
        }

        const group = await Group.findById(group_id);
        if (!group) return sendError(res, 404, 'Group not found');

        // Check authorization (only group moderators can add)
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return sendError(res, 403, 'Not authorized to add pilgrims to this group');
        }

        const searchTerm = identifier.trim();

        // Find pilgrim: must be created by one of the group's moderators (or if admin, bypass constraint)
        const privacyConstraint = req.user.role === 'admin' ? {} : { created_by: { $in: group.moderator_ids } };
        
        const existing_pilgrim = await User.findOne({
            user_type: 'pilgrim',
            ...privacyConstraint,
            $or: [
                { email: searchTerm.toLowerCase() },
                { phone_number: searchTerm },
                { national_id: searchTerm },
                { full_name: { $regex: searchTerm, $options: 'i' } }
            ]
        });

        if (!existing_pilgrim) {
            return sendError(res, 404, 'No registered pilgrim found matching this criteria within your allowed scope');
        }

        // Check if pilgrim is already in ANOTHER group
        const old_group = await Group.findOne({ pilgrim_ids: existing_pilgrim._id });
        if (old_group && old_group._id.toString() !== group_id.toString()) {
            // Remove from old group silently
            await Group.findByIdAndUpdate(old_group._id, { $pull: { pilgrim_ids: existing_pilgrim._id } });
            
            // Optionally, we could emit a status_update to the old group so their UI updates
            const io = req.app.get('socketio');
            if (io) {
                io.to(`group_${old_group._id}`).emit('status_update', {
                    user_id: existing_pilgrim._id,
                    group_id: old_group._id,
                    status: 'removed'
                });
            }
        }

        // Add to new group
        const updated_group = await Group.findByIdAndUpdate(
            group_id,
            { $addToSet: { pilgrim_ids: existing_pilgrim._id } },
            { new: true }
        ).populate('pilgrim_ids', 'full_name email phone_number national_id age gender current_latitude current_longitude battery_percent last_location_update is_online');

        // Clear limbo status as they are now assigned
        await User.findByIdAndUpdate(existing_pilgrim._id, {
            $set: { 
                limbo_reason: null,
                limbo_group_name: null
            }
        });

        // Notify the pilgrim that they were added to a group
        const io = req.app.get('socketio');
        if (io) {
            io.to(`user_${existing_pilgrim._id}`).emit('added-to-group', {
                group_id: group_id,
                group_name: updated_group.group_name,
                timestamp: new Date()
            });
            console.log(`[Socket] Pilgrim ${existing_pilgrim._id} added to group ${group_id}`);
        }

        sendSuccess(res, 200, 'Pilgrim successfully added/transferred to group', {
            group: {
                _id: updated_group._id,
                group_name: updated_group.group_name,
                pilgrims: updated_group.pilgrim_ids // Already populated
            }
        });
    } catch (error) {
        logger.error(`[Add Pilgrim Error]: ${error.message}`);
        sendServerError(res, logger, 'Add pilgrim to group error', error);
    }
};

// 6. Remove pilgrim from group
exports.remove_pilgrim_from_group = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const user_id = toObjectId(req.body.user_id);
        if (!group_id || !user_id) return sendError(res, 400, 'Invalid group or user identifier');

        const updated_group = await Group.findByIdAndUpdate(
            group_id,
            { $pull: { pilgrim_ids: user_id } },
            { new: true }
        );

        if (!updated_group) return sendError(res, 404, 'Group not found');

        // Mark the pilgrim as manually unassigned
        await User.findByIdAndUpdate(user_id, {
            $set: { 
                limbo_reason: 'manual',
                limbo_group_name: updated_group.group_name
            }
        });

        // Notify the removed pilgrim via socket
        const io = req.app.get('socketio');
        if (io) {
            // Notify the user specifically
            io.to(`user_${user_id}`).emit('removed-from-group', {
                group_id: group_id,
                group_name: updated_group.group_name,
                timestamp: new Date()
            });

            // Notify the group room so other moderators' UI update
            io.to(`group_${group_id}`).emit('status_update', {
                user_id: user_id,
                group_id: group_id,
                status: 'removed'
            });

            console.log(`[Socket] Pilgrim ${user_id} removed from group ${group_id}`);
        }

        sendSuccess(res, 200, 'Pilgrim removed from group', {
            group: {
                _id: updated_group._id,
                group_name: updated_group.group_name,
                pilgrim_ids: updated_group.pilgrim_ids
            }
        });
    } catch (error) {
        sendServerError(res, logger, 'Remove pilgrim from group error', error);
    }
};

// 7. Delete a group (unassigns all pilgrims automatically)
exports.delete_group = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        // Verify the user is a moderator of this group
        const group = await Group.findById(group_id);
        if (!group) return sendError(res, 404, 'Group not found');

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator) {
            return sendError(res, 403, 'Only group moderators can delete the group');
        }

        // Mark all pilgrims in the group as unassigned due to group deletion
        if (group.pilgrim_ids && group.pilgrim_ids.length > 0) {
            await User.updateMany(
                { _id: { $in: group.pilgrim_ids } },
                { 
                    $set: { 
                        limbo_reason: 'group_deleted',
                        limbo_group_name: group.group_name
                    }
                }
            );
            
            // Notify them via socket
            const io = req.app.get('socketio');
            if (io) {
                group.pilgrim_ids.forEach(pid => {
                    io.to(`user_${pid}`).emit('removed-from-group', {
                        group_id: group_id,
                        group_name: group.group_name,
                        reason: 'group_deleted'
                    });
                });
            }
        }

        // Delete the group
        await Group.findByIdAndDelete(group_id);

        sendSuccess(res, 200, 'Group deleted successfully', { group_id });
    } catch (error) {
        sendServerError(res, logger, 'Delete group error', error);
    }
};

// 8. Remove Moderator (Creator only)
exports.remove_moderator = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const user_id = toObjectId(req.params.user_id); // user_id of the moderator to remove
        if (!group_id || !user_id) return sendError(res, 400, 'Invalid group or user identifier');

        const group = await Group.findById(group_id);
        if (!group) return sendError(res, 404, 'Group not found');

        // Only creator can remove moderators
        if (group.created_by.toString() !== req.user.id.toString()) {
            return sendError(res, 403, 'Only the group creator can remove moderators');
        }

        // Cannot remove self
        if (user_id.toString() === req.user.id.toString()) {
            return sendError(res, 400, 'You cannot remove yourself. Use "Delete Group" instead');
        }

        // Check if user is actually a moderator
        if (!group.moderator_ids.some(id => id.toString() === user_id.toString())) {
            return sendError(res, 400, 'User is not a moderator of this group');
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

        sendSuccess(res, 200, 'Moderator removed successfully');
    } catch (error) {
        sendServerError(res, logger, 'Remove moderator error', error);
    }
};

// 9. Leave Group (Invited moderators only)
exports.leave_group = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const user_id = toObjectId(req.user.id);
        if (!group_id || !user_id) return sendError(res, 400, 'Invalid group or user identifier');

        const group = await Group.findById(group_id);
        if (!group) return sendError(res, 404, 'Group not found');

        // Check if user is a moderator
        if (!group.moderator_ids.some(id => id.toString() === user_id.toString())) {
            return sendError(res, 400, 'You are not a moderator of this group');
        }

        if (group.moderator_ids.length === 1) {
            return sendError(res, 400, 'You are the only moderator left. You must delete the group permanently.');
        }

        // Handle group creator leaving
        if (group.created_by.toString() === user_id.toString()) {
            const new_creator_id = req.body.new_creator_id;
            if (!new_creator_id) {
                return sendError(res, 400, 'Group creator must reassign the group to another moderator before leaving');
            }
            if (!group.moderator_ids.some(id => id.toString() === new_creator_id.toString())) {
                return sendError(res, 400, 'New creator must be an existing moderator of the group');
            }
            group.created_by = new_creator_id;
        }

        // Remove from moderators list
        group.moderator_ids.pull(user_id);
        await group.save();

        // Get the leaving user's details for the notification
        const leavingUser = await User.findById(user_id);
        const leavingUserName = leavingUser ? leavingUser.full_name : 'A moderator';

        // Notify the creator
        await Notification.create({
            user_id: group.created_by,
            type: 'moderator_left',
            title: 'Moderator Left Group',
            message: `${leavingUserName} has left the group "${group.group_name}"`,
            data: {
                group_id: group._id,
                group_name: group.group_name
            }
        });

        sendSuccess(res, 200, 'You have left the group successfully');
    } catch (error) {
        sendServerError(res, logger, 'Leave group error', error);
    }
};

// Update group details
exports.update_group_details = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const group_name = normalizeString(req.body.group_name);
        const { allow_pilgrim_navigation, check_in_date, check_out_date } = req.body;
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);

        if (!is_admin && !is_group_moderator) {
            return sendError(res, 403, 'Not authorized to update this group');
        }

        // Check if new group name already exists for this moderator (only if moderator is updating)
        if (group_name && !is_admin) {
            const existing_group_with_name = await Group.findOne({
                group_name,
                moderator_ids: req.user.id,
                _id: { $ne: group_id } // Exclude current group
            });
            if (existing_group_with_name) {
                return sendError(res, 400, 'You already have a group with this name');
            }
        }

        group.group_name = group_name || group.group_name;
        if (check_in_date !== undefined) group.check_in_date = check_in_date;
        if (check_out_date !== undefined) group.check_out_date = check_out_date;
        if (typeof allow_pilgrim_navigation === 'boolean') {
            group.allow_pilgrim_navigation = allow_pilgrim_navigation;
        }
        await group.save();

        const updated_group = await Group.findById(group_id)
            .populate('moderator_ids', 'full_name email')
            .populate('assigned_hotel_ids', 'name city rooms')
            .populate('assigned_bus_ids', 'bus_number destination departure_time driver_name')
            .lean();

        // Clean up __v and pilgrim_ids for response to match docs
        delete updated_group.__v;
        // The docs show pilgrim_ids as an array of IDs in the PUT response, so no need to delete or populate details for it

        sendSuccess(res, 200, 'Group updated successfully', { group: updated_group });

    } catch (error) {
        sendServerError(res, logger, 'Update group details error', error);
    }
};

// ============ SUGGESTED AREAS ============

// Add a suggested area to a group
exports.add_suggested_area = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const { name, description, latitude, longitude, area_type, meetpoint_time, reminder_minutes } = req.body;
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');
        const type = area_type || 'suggestion';

        if (!name || latitude === undefined || longitude === undefined) {
            return sendError(res, 400, 'Name, latitude, and longitude are required');
        }

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return sendError(res, 403, 'Not authorized');
        }

        if (type === 'meetpoint') {
            const existing = await SuggestedArea.findOne({ group_id, area_type: 'meetpoint', active: { $ne: false } });
            if (existing) {
                return sendError(res, 409, 'A meetpoint already exists. Delete the current one before adding a new one');
            }
        }

        const area = await SuggestedArea.create({
            group_id,
            created_by: req.user.id,
            name: name.trim(),
            description: (description || '').trim(),
            area_type: type,
            latitude,
            longitude,
            meetpoint_time: type === 'meetpoint' ? meetpoint_time : null,
            reminder_minutes: type === 'meetpoint' ? (reminder_minutes || 0) : 0
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
        const pilgrimDocs = await User.find(
            { _id: { $in: group.pilgrim_ids }, user_type: 'pilgrim' },
            '_id fcm_token'
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

        // --- FCM push so offline / killed-app pilgrims receive the notification ---
        const { sendPushNotification } = require('../services/pushNotificationService');
        const fcmTokens = pilgrimDocs.map(p => p.fcm_token).filter(Boolean);
        if (fcmTokens.length > 0) {
            try {
                await sendPushNotification(fcmTokens, notifTitle, notifMessage, {
                    type: notifType,
                    notification_type: notifType,
                    group_id: group_id.toString(),
                    group_name: group.group_name,
                    area_id: area._id.toString(),
                }, type === 'meetpoint');
                logger.info(`[FCM] ${notifType} push sent to ${fcmTokens.length} token(s)`);
            } catch (fcmErr) {
                logger.error(`[FCM] ${notifType} push failed: ${fcmErr.message}`);
            }
        }

        // --- If meetpoint, also post it as an urgent message in the group chat ---
        if (type === 'meetpoint') {
            try {
                const Message = require('../models/message_model');
                const meetpointMsg = await Message.create({
                    group_id,
                    sender_id: req.user.id,
                    sender_model: 'User',
                    type: 'meetpoint',
                    content: description ? description.trim() : name.trim(),
                    is_urgent: true,
                    meetpoint_data: {
                        area_id: area._id,
                        name: name.trim(),
                        latitude,
                        longitude,
                        meetpoint_time: area.meetpoint_time,
                        reminder_minutes: area.reminder_minutes
                    }
                });
                await meetpointMsg.populate('sender_id', 'full_name profile_picture role');
                if (io) {
                    io.to(`group_${group_id}`).emit('new_message', meetpointMsg);
                }

                // --- Schedule Meetpoint Notifications (Reminder + Arrival) ---
                await scheduleMeetpointNotifications(area, group, req.user.id);
                
            } catch (msgErr) {
                // Log but don't fail the whole request — area + notifications already done
                logger.error(`Meetpoint chat message/notifications scheduling failed: ${msgErr.message}`);
            }
        }

        sendSuccess(res, 201, 'Suggested area added successfully', { area });
    } catch (error) {
        sendServerError(res, logger, 'Add suggested area error', error);
    }
};

// Get all active suggested areas for a group
exports.get_suggested_areas = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const areas = await SuggestedArea.find({ group_id, active: { $ne: false } })
            .populate('created_by', 'full_name')
            .sort({ createdAt: -1 })
            .lean();

        logger.info(`Fetching suggested areas for group ${group_id}: ${areas.length} areas found`);
        
        // Return areas wrapped in data object
        sendSuccess(res, 200, null, { areas });
    } catch (error) {
        sendServerError(res, logger, 'Get suggested areas error', error);
    }
};

// Delete (soft) a suggested area
exports.delete_suggested_area = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const area_id = toObjectId(req.params.area_id);
        if (!group_id || !area_id) return sendError(res, 400, 'Invalid group or area identifier');

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return sendError(res, 403, 'Not authorized');
        }

        const area = await SuggestedArea.findOneAndUpdate(
            { _id: area_id, group_id, active: { $ne: false } },
            { active: false },
            { new: true }
        );

        if (!area) {
            return sendError(res, 404, 'Suggested area not found');
        }

        // Remove related alert notifications from pilgrim alerts list
        await Notification.deleteMany({
            type: area.area_type === 'meetpoint' ? 'meetpoint' : 'suggested_area',
            'data.group_id': group_id,
            $or: [
                { 'data.area_id': area_id },
                { 'data.area_id': area._id }
            ]
        });

        // If deleting a meetpoint, also remove the linked meetpoint chat message(s) and notifications
        let removedMessageIds = [];
        if (area.area_type === 'meetpoint') {
            // Cancel and delete reminders
            const Reminder = require('../models/reminder_model');
            const scheduler = require('../services/reminderScheduler');
            if (area.reminder_ids && area.reminder_ids.length > 0) {
                for (const rId of area.reminder_ids) scheduler.cancel(rId);
                await Reminder.deleteMany({ _id: { $in: area.reminder_ids } });
            }
            // Defensive cleanup
            const strayReminders = await Reminder.find({ related_area_id: area._id }).select('_id');
            if (strayReminders.length > 0) {
                const strayIds = strayReminders.map(r => r._id);
                for (const rId of strayIds) scheduler.cancel(rId);
                await Reminder.deleteMany({ _id: { $in: strayIds } });
            }

            const meetpointMessages = await Message.find({
                group_id,
                type: 'meetpoint',
                $or: [
                    { 'meetpoint_data.area_id': area_id },
                    { 'meetpoint_data.area_id': area._id }
                ]
            }).select('_id').lean();

            removedMessageIds = meetpointMessages.map(m => m._id.toString());

            if (removedMessageIds.length > 0) {
                await Message.deleteMany({ _id: { $in: removedMessageIds } });
            }
        }

        // --- Socket.io real-time broadcast ---
        const io = req.app.get('socketio');
        if (io) {
            io.to(`group_${group_id}`).emit('area_deleted', {
                area_id,
                group_id,
                area_type: area.area_type
            });

            // Remove linked meetpoint message(s) from open chats in real time
            for (const messageId of removedMessageIds) {
                io.to(`group_${group_id}`).emit('message_deleted', {
                    message_id: messageId,
                    group_id
                });
            }

            // Refresh pilgrim alerts badge/list after notification deletion
            for (const pilgrimId of group.pilgrim_ids || []) {
                io.to(`user_${pilgrimId}`).emit('notification_refresh');
            }
        }

        sendSuccess(res, 200, 'Suggested area removed');
    } catch (error) {
        sendServerError(res, logger, 'Delete suggested area error', error);
    }
};

// Update a suggested area
exports.update_suggested_area = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const area_id = toObjectId(req.params.area_id);
        const { name, description, latitude, longitude, meetpoint_time, reminder_minutes } = req.body;

        if (!group_id || !area_id) return sendError(res, 400, 'Invalid group or area identifier');

        const group = await Group.findById(group_id);
        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_group_moderator && req.user.role !== 'admin') {
            return sendError(res, 403, 'Not authorized');
        }

        // Build update object (only include provided fields)
        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (latitude !== undefined) updateData.latitude = latitude;
        if (longitude !== undefined) updateData.longitude = longitude;
        if (meetpoint_time !== undefined) updateData.meetpoint_time = meetpoint_time;
        if (reminder_minutes !== undefined) updateData.reminder_minutes = reminder_minutes;

        if (Object.keys(updateData).length === 0) {
            return sendError(res, 400, 'No valid fields to update');
        }

        const area = await SuggestedArea.findOneAndUpdate(
            { _id: area_id, group_id, active: { $ne: false } },
            updateData,
            { new: true }
        );

        if (!area) {
            return sendError(res, 404, 'Suggested area not found');
        }

        // --- Socket.io real-time broadcast ---
        const io = req.app.get('socketio');
        if (io) {
            io.to(`group_${group_id}`).emit('area_updated', area);
        }

        // --- If meetpoint time/reminder changed, re-schedule notifications ---
        if (area.area_type === 'meetpoint' && (meetpoint_time !== undefined || reminder_minutes !== undefined)) {
            try {
                await scheduleMeetpointNotifications(area, group, req.user.id);
            } catch (err) {
                logger.error(`Failed to re-schedule meetpoint notifications: ${err.message}`);
            }
        }

        sendSuccess(res, 200, 'Suggested area updated', area);
    } catch (error) {
        sendServerError(res, logger, 'Update suggested area error', error);
    }
};

// Get resource options assigned to a group (moderator/admin)
exports.get_group_resource_options = async (req, res) => {
    try {
        const group_id = toObjectId(req.params.group_id);
        const exclude_pilgrim_id = toObjectId(req.query.exclude_pilgrim_id);
        if (!group_id) return sendError(res, 400, 'Invalid group identifier');

        const group = await Group.findById(group_id)
            .select('_id moderator_ids assigned_hotel_ids assigned_bus_ids');

        if (!group) {
            return sendError(res, 404, 'Group not found');
        }

        const is_admin = req.user.role === 'admin';
        const is_group_moderator = group.moderator_ids.some(mod => mod.toString() === req.user.id);
        if (!is_admin && !is_group_moderator) {
            return sendError(res, 403, 'Not authorized to view this group');
        }

        const [hotels, buses] = await Promise.all([
            Hotel.find({ _id: { $in: group.assigned_hotel_ids || [] }, active: true }).sort({ name: 1 }).lean(),
            Bus.find({ _id: { $in: group.assigned_bus_ids || [] }, active: true }).sort({ destination: 1, departure_time: 1 }).lean()
        ]);

        // Calculate Global Occupancy
        // We count all users in the system (across all groups) assigned to these rooms
        const occupancies = await User.aggregate([
            { 
                $match: { 
                    hotel_id: { $in: group.assigned_hotel_ids || [] },
                    room_id: { $ne: null },
                    active: true
                } 
            },
            {
                $group: {
                    _id: { hotel_id: "$hotel_id", room_id: "$room_id" },
                    count: { $sum: 1 },
                    // Track if the excluded pilgrim is in this room
                    includesExcluded: {
                        $max: {
                            $cond: [
                                { $eq: ["$_id", exclude_pilgrim_id] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const occupancyMap = {};
        occupancies.forEach(occ => {
            const key = `${occ._id.hotel_id}_${occ._id.room_id}`;
            occupancyMap[key] = {
                count: occ.count,
                includesExcluded: occ.includesExcluded === 1
            };
        });

        // Enrich and filter rooms
        const filteredHotels = hotels.map(hotel => {
            const enrichedRooms = (hotel.rooms || []).filter(room => {
                if (!room.active) return false;

                const occData = occupancyMap[`${hotel._id}_${room._id}`] || { count: 0, includesExcluded: false };
                const count = occData.count;
                const capacity = room.capacity || 1;

                // Attach occupancy info for frontend reference
                room.current_occupancy = count;
                
                // HIDE if reached capacity, UNLESS the pilgrim being edited is already in this room
                if (count >= capacity && !occData.includesExcluded) {
                    return false;
                }
                return true;
            });

            return { ...hotel, rooms: enrichedRooms };
        }).filter(h => h.rooms.length > 0 || (h.active && group.assigned_hotel_ids.includes(h._id)));

        sendSuccess(res, 200, null, {
            hotels: filteredHotels,
            buses,
        });
    } catch (error) {
        sendServerError(res, logger, 'Get group resource options error', error);
    }
};