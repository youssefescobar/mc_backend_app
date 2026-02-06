const crypto = require('crypto');
const PendingPilgrim = require('../models/pending_pilgrim_model');
const { sendGroupInvitationEmail, sendPilgrimInvitationEmail } = require('../config/email_service');

// ... existing code ...

// Invite a pilgrim to the group
const invite_pilgrim = async (req, res) => {
    try {
        const { group_id } = req.params;
        const { email } = req.body;
        const inviter_id = req.user.id;

        // 1. Verify Inviter is Moderator of Group
        const group = await Group.findById(group_id);
        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }

        const is_moderator = group.moderator_ids.some(id => id.toString() === inviter_id.toString()) ||
            group.created_by.toString() === inviter_id.toString();

        if (!is_moderator) {
            return res.status(403).json({ success: false, message: 'Only group moderators can invite pilgrims' });
        }

        // 2. Check if already a pending pilgrim
        const existing_pending = await PendingPilgrim.findOne({ email: email.toLowerCase(), group_id });
        if (existing_pending) {
            return res.status(400).json({ success: false, message: 'Pilgrim already invited to this group' });
        }

        // 3. Check if already a registered pilgrim (optional: redirect to login info)
        // For now, we allow sending invite even if registered, so they can be added to group simply?
        // Actually, better to check. If registered, use the "Add Pilgrim" flow instead.
        // But for "Invitation" flow, we assume they are new to the app or this specific group flow.

        // 4. Generate Token
        const token = crypto.randomBytes(32).toString('hex');
        const expires_at = new Date();
        expires_at.setDate(expires_at.getDate() + 7); // 7 days expiry

        // 5. Create Pending Pilgrim Record
        await PendingPilgrim.create({
            email: email.toLowerCase(),
            group_id,
            invited_by: inviter_id,
            verification_token: token,
            expires_at
        });

        // 6. Send Email with Deep Link
        const inviter = await User.findById(inviter_id);
        const deepLink = `mc_mobile://pilgrim-signup?token=${token}`; // Deep link scheme

        await sendPilgrimInvitationEmail(email.toLowerCase(), inviter.full_name, group.group_name, deepLink);

        res.status(201).json({
            success: true,
            message: 'Pilgrim invitation sent successfully'
        });

    } catch (error) {
        console.error('Invite pilgrim error:', error);
        res.status(500).json({ success: false, message: 'Failed to invite pilgrim' });
    }
};

// (Moved export to end of file)

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

        // Check if user exists
        const invitee = await User.findOne({ email: email.toLowerCase() });

        // Check if already a moderator
        if (invitee && group.moderator_ids.some(id => id.toString() === invitee._id.toString())) {
            return res.status(400).json({ success: false, message: 'User is already a moderator of this group' });
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
        const invitation = await Invitation.create({
            group_id,
            inviter_id,
            invitee_id: invitee ? invitee._id : null,
            invitee_email: email.toLowerCase()
        });

        // Get inviter info for email/notification
        const inviter = await User.findById(inviter_id);

        // Create notification for invitee if registered
        if (invitee) {
            await Notification.create({
                user_id: invitee._id,
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

        const invitation = await Invitation.findById(id).populate('group_id');
        if (!invitation) {
            return res.status(404).json({ success: false, message: 'Invitation not found' });
        }

        // Verify this invitation belongs to the current user
        if (invitation.invitee_id?.toString() !== user_id.toString() &&
            invitation.invitee_email !== req.user.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: 'This invitation is not for you' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Invitation is already ${invitation.status}` });
        }

        // Add user to group moderators
        await Group.findByIdAndUpdate(invitation.group_id._id, {
            $addToSet: { moderator_ids: user_id }
        });

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

        res.json({
            success: true,
            message: 'Invitation accepted! You are now a moderator of this group.',
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

        const invitation = await Invitation.findById(id).populate('group_id');
        if (!invitation) {
            return res.status(404).json({ success: false, message: 'Invitation not found' });
        }

        // Verify this invitation belongs to the current user
        if (invitation.invitee_id?.toString() !== user_id.toString() &&
            invitation.invitee_email !== req.user.email.toLowerCase()) {
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
        const user_email = req.user.email.toLowerCase();

        const invitations = await Invitation.find({
            $or: [
                { invitee_id: user_id },
                { invitee_email: user_email }
            ],
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
    get_my_invitations,
    invite_pilgrim
};
