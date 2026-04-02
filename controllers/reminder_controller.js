const Reminder = require('../models/reminder_model');
const mongoose = require('mongoose');
const { logger } = require('../config/logger');
const scheduler = require('../services/reminderScheduler');

const toObjectId = (value) => {
    if (!mongoose.Types.ObjectId.isValid(String(value || ''))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

// ── Create Reminder ───────────────────────────────────────────────────────────
exports.create_reminder = async (req, res) => {
    try {
        const {
            group_id,
            target_type,       // 'pilgrim' | 'group'
            pilgrim_id,        // required when target_type === 'pilgrim'
            text,
            scheduled_at,      // ISO 8601 string
            repeat_count,
            repeat_interval_min
        } = req.body;

        const safe_group_id = toObjectId(group_id);
        const safe_pilgrim_id = pilgrim_id ? toObjectId(pilgrim_id) : null;
        const safe_user_id = toObjectId(req.user.id);

        if (!safe_group_id || !safe_user_id || !target_type || !text || !scheduled_at) {
            return res.status(400).json({ success: false, message: 'group_id, target_type, text and scheduled_at are required' });
        }
        if (target_type === 'pilgrim' && !safe_pilgrim_id) {
            return res.status(400).json({ success: false, message: 'pilgrim_id is required when target_type is "pilgrim"' });
        }
        if (new Date(scheduled_at) <= new Date()) {
            return res.status(400).json({ success: false, message: 'scheduled_at must be in the future' });
        }

        const reminder = await Reminder.create({
            created_by: safe_user_id,
            group_id: safe_group_id,
            target_type,
            pilgrim_id: target_type === 'pilgrim' ? safe_pilgrim_id : null,
            text: text.trim(),
            scheduled_at: new Date(scheduled_at),
            repeat_count: Math.min(Math.max(parseInt(repeat_count) || 1, 1), 20),
            repeat_interval_min: Math.max(parseInt(repeat_interval_min) || 15, 1),
            status: 'pending',
            fires_sent: 0
        });

        // Hand off to the scheduler
        scheduler.add(reminder);

        logger.info(`[Reminder] Created ${reminder._id} by ${req.user.id} for group ${group_id}`);
        res.status(201).json({ success: true, reminder });
    } catch (err) {
        logger.error(`[Reminder] create error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to create reminder' });
    }
};

// ── List Reminders for a Group ────────────────────────────────────────────────
exports.get_reminders = async (req, res) => {
    try {
        const group_id = toObjectId(req.query.group_id);
        if (!group_id) {
            return res.status(400).json({ success: false, message: 'group_id is required' });
        }

        const reminders = await Reminder.find({ group_id })
            .populate('pilgrim_id', 'full_name')
            .populate('created_by', 'full_name')
            .sort({ scheduled_at: -1 })
            .limit(100);

        res.json({ success: true, reminders });
    } catch (err) {
        logger.error(`[Reminder] get error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch reminders' });
    }
};

// ── Cancel Reminder ───────────────────────────────────────────────────────────
exports.cancel_reminder = async (req, res) => {
    try {
        const id = toObjectId(req.params.id);
        const user_id = toObjectId(req.user.id);
        if (!id || !user_id) {
            return res.status(400).json({ success: false, message: 'Invalid reminder or user identifier' });
        }

        const reminder = await Reminder.findOneAndUpdate(
            { _id: id, created_by: user_id, status: { $in: ['pending', 'active'] } },
            { status: 'cancelled' },
            { new: true }
        );

        if (!reminder) {
            return res.status(404).json({ success: false, message: 'Reminder not found or already finished' });
        }

        // Remove from scheduler
        scheduler.cancel(id);

        logger.info(`[Reminder] Cancelled ${id} by ${req.user.id}`);
        res.json({ success: true, reminder });
    } catch (err) {
        logger.error(`[Reminder] cancel error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to cancel reminder' });
    }
};

// ── Hard Delete Reminder ──────────────────────────────────────────────────────
exports.delete_reminder = async (req, res) => {
    try {
        const id = toObjectId(req.params.id);
        const user_id = toObjectId(req.user.id);
        if (!id || !user_id) {
            return res.status(400).json({ success: false, message: 'Invalid reminder or user identifier' });
        }

        const reminder = await Reminder.findOneAndDelete({ _id: id, created_by: user_id });

        if (!reminder) {
            return res.status(404).json({ success: false, message: 'Reminder not found' });
        }

        // Remove from scheduler (no-op if already fired/gone)
        scheduler.cancel(id);

        logger.info(`[Reminder] Hard-deleted ${id} by ${req.user.id}`);
        res.json({ success: true, message: 'Reminder deleted' });
    } catch (err) {
        logger.error(`[Reminder] delete error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete reminder' });
    }
};
