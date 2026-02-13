const crypto = require('crypto');
const User = require('../models/user_model');
const Pilgrim = require('../models/pilgrim_model');
const Invitation = require('../models/invitation_model');
const Group = require('../models/group_model');
const Notification = require('../models/notification_model');
const PendingPilgrim = require('../models/pending_pilgrim_model');
const { sendGroupInvitationEmail } = require('../config/email_service');

// Send invitation to another moderator
const send_invitation = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { email } = req.body;
        const inviter_id = req.user.id;



        // Get group and verify inviter is a moderator
        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }

        const is_moderator = group.moderator_ids.some(id => id.toString() === inviter_id.toString());
        if (!is_moderator) {
            return res.status(403).json({ success: false, message: 'Only group moderators can send invitations' });
        }

        // Check if user exists (as moderator/admin or as pilgrim)
        const invitee = await User.findOne({ email: email.toLowerCase() });
        const invitee_pilgrim = !invitee ? await Pilgrim.findOne({ email: email.toLowerCase() }) : null;

        // Check if already a moderator
        if (invitee && group.moderator_ids.some(id => id.toString() === invitee._id.toString())) {
            return res.status(400).json({ success: false, message: 'User is already a moderator of this group' });
        }

        // Check if pilgrim is already in the group
        if (invitee_pilgrim && group.pilgrim_ids.some(id => id.toString() === invitee_pilgrim._id.toString())) {
            return res.status(400).json({ success: false, message: 'This pilgrim is already a member of this group' });
        }

        // Check for existing pending invitation
        const existing_invitation = await Invitation.findOne({
            group_id,
            invitee_email: email.toLowerCase(),
            status: 'pending'
        });

        if (existing_invitation) {
            return res.status(400).json({ success: false, message: 'An invitation is already pending for this email' });
        }

        // Create invitation
        const invitee_ref_id = invitee ? invitee._id : (invitee_pilgrim ? invitee_pilgrim._id : null);
        const invitation = await Invitation.create({
            group_id,
            inviter_id,
            invitee_id: invitee_ref_id,
            invitee_email: email.toLowerCase()
        });

        // Get inviter info for email/notification
        const inviter = await User.findById(inviter_id);

        // Create notification for invitee if registered (moderator or pilgrim)
        const notify_id = invitee ? invitee._id : (invitee_pilgrim ? invitee_pilgrim._id : null);
        if (notify_id) {
            await Notification.create({
                user_id: notify_id,
                type: 'group_invitation',
                title: 'Group Invitation',
                message: `${inviter.full_name} invited you to join "${group.group_name}"`,
                data: {
                    invitation_id: invitation._id,
                    group_id: group._id,
                    group_name: group.group_name,
                    inviter_name: inviter.full_name
                }
            });
        }

        // Send invitation email
        const frontend_url = process.env.FRONTEND_URL || 'http://localhost:3000';
        await sendGroupInvitationEmail(email, inviter.full_name, group.group_name, frontend_url, inviter.profile_picture);

        res.status(201).json({
            success: true,
            message: 'Invitation sent successfully',
            invitation_id: invitation._id
        });
    } catch (error) {
        console.error('Send invitation error:', error);
        res.status(500).json({ success: false, message: 'Failed to send invitation' });
    }
};

// Accept invitation
const accept_invitation = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;
        // Look up in both User and Pilgrim collections
        const user = await User.findById(user_id).select('email');
        const pilgrim_account = !user ? await Pilgrim.findById(user_id).select('email') : null;
        const account = user || pilgrim_account;
        const user_email = account?.email ? account.email.toLowerCase() : null;

        const invitation = await Invitation.findById(id).populate('group_id');
        if (!invitation) {
            return res.status(404).json({ success: false, message: 'Invitation not found' });
        }

        // Verify this invitation belongs to the current user
        if (invitation.invitee_id?.toString() !== user_id.toString() &&
            (!user_email || invitation.invitee_email !== user_email)) {
            return res.status(403).json({ success: false, message: 'This invitation is not for you' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Invitation is already ${invitation.status}` });
        }

        // Determine if the user is a moderator or pilgrim and add accordingly
        const accepting_user = await User.findById(user_id);
        if (accepting_user) {
            // User is a moderator/admin — add to moderator_ids
            await Group.findByIdAndUpdate(invitation.group_id._id, {
                $addToSet: { moderator_ids: user_id }
            });
        } else {
            // User is a pilgrim — add to pilgrim_ids
            await Group.findByIdAndUpdate(invitation.group_id._id, {
                $addToSet: { pilgrim_ids: user_id }
            });
        }

        // Update invitation status
        invitation.status = 'accepted';
        await invitation.save();

        // Mark related notification as read
        await Notification.updateMany(
            { 'data.invitation_id': invitation._id, user_id },
            { read: true }
        );

        // Notify the inviter
        await Notification.create({
            user_id: invitation.inviter_id,
            type: 'invitation_accepted',
            title: 'Invitation Accepted',
            message: `${req.user.full_name} accepted your invitation to join "${invitation.group_id.group_name}"`,
            data: {
                invitation_id: invitation._id,
                group_id: invitation.group_id._id,
                group_name: invitation.group_id.group_name
            }
        });

        const role_label = accepting_user ? 'moderator' : 'member';
        res.json({
            success: true,
            message: `Invitation accepted! You are now a ${role_label} of this group.`,
            group_id: invitation.group_id._id
        });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ success: false, message: 'Failed to accept invitation' });
    }
};

// Decline invitation
const decline_invitation = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;
        // Look up in both User and Pilgrim collections
        const user = await User.findById(user_id).select('email');
        const pilgrim_account = !user ? await Pilgrim.findById(user_id).select('email') : null;
        const account = user || pilgrim_account;
        const user_email = account?.email ? account.email.toLowerCase() : null;

        const invitation = await Invitation.findById(id).populate('group_id');
        if (!invitation) {
            return res.status(404).json({ success: false, message: 'Invitation not found' });
        }

        // Verify this invitation belongs to the current user
        if (invitation.invitee_id?.toString() !== user_id.toString() &&
            (!user_email || invitation.invitee_email !== user_email)) {
            return res.status(403).json({ success: false, message: 'This invitation is not for you' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Invitation is already ${invitation.status}` });
        }

        // Update invitation status
        invitation.status = 'declined';
        await invitation.save();

        // Mark related notification as read
        await Notification.updateMany(
            { 'data.invitation_id': invitation._id, user_id },
            { read: true }
        );

        // Notify the inviter
        await Notification.create({
            user_id: invitation.inviter_id,
            type: 'invitation_declined',
            title: 'Invitation Declined',
            message: `${req.user.full_name} declined your invitation to join "${invitation.group_id.group_name}"`,
            data: {
                invitation_id: invitation._id,
                group_id: invitation.group_id._id,
                group_name: invitation.group_id.group_name
            }
        });

        res.json({
            success: true,
            message: 'Invitation declined'
        });
    } catch (error) {
        console.error('Decline invitation error:', error);
        res.status(500).json({ success: false, message: 'Failed to decline invitation' });
    }
};

// Get pending invitations for current user
const get_my_invitations = async (req, res) => {
    try {
        const user_id = req.user.id;
        // Look up in both User and Pilgrim collections
        const user = await User.findById(user_id).select('email');
        const pilgrim_account = !user ? await Pilgrim.findById(user_id).select('email') : null;
        const account = user || pilgrim_account;
        const user_email = account?.email ? account.email.toLowerCase() : null;

        const orFilters = [{ invitee_id: user_id }];
        if (user_email) {
            orFilters.push({ invitee_email: user_email });
        }

        const invitations = await Invitation.find({
            $or: orFilters,
            status: 'pending'
        })
            .populate('group_id', 'group_name')
            .populate('inviter_id', 'full_name email')
            .sort({ created_at: -1 });

        res.json({
            success: true,
            invitations
        });
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ success: false, message: 'Failed to get invitations' });
    }
};

module.exports = {
    send_invitation,
    accept_invitation,
    decline_invitation,
    get_my_invitations
};
