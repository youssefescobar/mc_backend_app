/**
 * ReminderScheduler
 * -----------------
 * Owns all reminder timing. On boot it rehydrates from DB and schedules
 * setTimeout handles for every pending/active reminder. Each fire sends
 * a TTS FCM (identical to the existing urgent-TTS flow) then schedules the
 * next fire if repeats remain.
 *
 * Key properties:
 *  - Precision: per-second (setTimeout, not cron)
 *  - Restart-safe: rehydrates from DB on startup
 *  - Overdue: if a fire is < 10 min late it fires immediately; further-past
 *    fires are skipped and the next scheduled one is used (or completed if done)
 */

const { logger } = require('../config/logger');

// Prevent import cycles — require lazily inside functions
const { sendPushNotification } = require('./pushNotificationService');
const Notification = require('../models/notification_model');

/** ms threshold: fire immediately if we're within this window past due */
const OVERDUE_GRACE_MS = 10 * 60 * 1000; // 10 minutes

/** Map of reminderId (string) → active timeout handle(s) */
const _handles = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call once at server startup. Loads all non-terminal reminders from DB
 * and schedules their next fire.
 */
async function init() {
    const Reminder = require('../models/reminder_model');
    try {
        const reminders = await Reminder.find({
            status: { $in: ['pending', 'active'] }
        });
        logger.info(`[ReminderScheduler] Rehydrating ${reminders.length} reminder(s)`);
        for (const r of reminders) {
            scheduleNext(r);
        }
    } catch (err) {
        logger.error('[ReminderScheduler] init error:', err);
    }
}

/**
 * Schedule a new reminder (call after saving to DB from the controller).
 */
function add(reminder) {
    scheduleNext(reminder);
}

/**
 * Cancel all pending timeouts for a reminder (when the moderator cancels it).
 */
function cancel(reminderId) {
    const key = reminderId.toString();
    const handle = _handles.get(key);
    if (handle) {
        clearTimeout(handle);
        _handles.delete(key);
        logger.info(`[ReminderScheduler] Cancelled timer for reminder ${key}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Work out when the NEXT fire should happen given current state, then arm
 * a setTimeout for it.
 */
function scheduleNext(reminder) {
    const Reminder = require('../models/reminder_model');
    const key = reminder._id.toString();

    // Clear any existing handle for this reminder
    const old = _handles.get(key);
    if (old) clearTimeout(old);

    const now = Date.now();
    const fireCount = reminder.fires_sent || 0;
    const totalFires = reminder.repeat_count || 1;

    if (fireCount >= totalFires) {
        // Already done — mark completed if not already
        Reminder.findByIdAndUpdate(key, { status: 'completed' }).catch(() => {});
        return;
    }

    // Calculate the absolute time for the NEXT fire
    const firstFire = new Date(reminder.scheduled_at).getTime();
    const intervalMs = (reminder.repeat_interval_min || 15) * 60 * 1000;
    const nextFireAt = firstFire + fireCount * intervalMs;

    const delayMs = nextFireAt - now;

    if (delayMs < -OVERDUE_GRACE_MS) {
        // Fire is more than 10 min overdue — skip it, advance counter, try again
        logger.warn(`[ReminderScheduler] Reminder ${key} fire #${fireCount + 1} is overdue by ${Math.round(-delayMs / 60000)} min — skipping`);
        // Advance fires_sent in-memory to skip, then re-compute
        const updated = Object.assign({}, reminder.toObject ? reminder.toObject() : reminder, {
            fires_sent: fireCount + 1
        });
        scheduleNext(updated);
        return;
    }

    const effectiveDelay = Math.max(0, delayMs); // fire immediately if within grace

    logger.info(`[ReminderScheduler] Reminder ${key} fire #${fireCount + 1}/${totalFires} in ${Math.round(effectiveDelay / 1000)}s`);

    const handle = setTimeout(() => {
        _handles.delete(key);
        _fire(reminder._id.toString(), key);
    }, effectiveDelay);

    // unref so the timer doesn't keep the process alive during shutdown
    if (handle.unref) handle.unref();
    _handles.set(key, handle);
}

/**
 * Execute one fire: send FCM(s), update DB, schedule next if repeats remain.
 */
async function _fire(reminderId, key) {
    const Reminder = require('../models/reminder_model');
    const User = require('../models/user_model');
    const Group = require('../models/group_model');

    try {
        const reminder = await Reminder.findById(reminderId);
        if (!reminder || reminder.status === 'cancelled' || reminder.status === 'completed') {
            logger.info(`[ReminderScheduler] Reminder ${reminderId} is ${reminder?.status ?? 'gone'} — skipping fire`);
            return;
        }

        // Gather FCM tokens
        let tokens = [];

        if (reminder.target_type === 'pilgrim' && reminder.pilgrim_id) {
            const pilgrim = await User.findById(reminder.pilgrim_id).select('fcm_token');
            if (pilgrim?.fcm_token) tokens = [pilgrim.fcm_token];
        } else {
            // Whole group
            const group = await Group.findById(reminder.group_id).select('pilgrim_ids');
            if (group?.pilgrim_ids?.length) {
                const pilgrims = await User.find({
                    _id: { $in: group.pilgrim_ids },
                    fcm_token: { $ne: null }
                }).select('fcm_token');
                tokens = pilgrims.map(p => p.fcm_token).filter(Boolean);
            }
        }

        if (tokens.length > 0) {
            // Reuse the exact same FCM payload shape as urgent TTS messages
            await sendPushNotification(
                tokens,
                'Reminder',
                reminder.text,
                {
                    type: 'urgent',
                    messageType: 'reminder_tts',
                    body: reminder.text,
                    reminderId: reminderId
                },
                true // isUrgent = true → data-only, background handler does sound+TTS
            );
            logger.info(`[ReminderScheduler] ✓ Reminder ${reminderId} fire #${reminder.fires_sent + 1} sent to ${tokens.length} device(s)`);

            // Persist a Notification record so it appears in the pilgrim(s) Alerts tab
            const targetUserIds = reminder.target_type === 'pilgrim' && reminder.pilgrim_id
                ? [reminder.pilgrim_id]
                : await (async () => {
                      const Group = require('../models/group_model');
                      const grp = await Group.findById(reminder.group_id).select('pilgrim_ids');
                      return grp?.pilgrim_ids ?? [];
                  })();

            const notifDocs = targetUserIds.map(uid => ({
                user_id: uid,
                type: 'reminder',
                title: 'Reminder',
                message: reminder.text,
                data: { group_id: reminder.group_id }
            }));
            if (notifDocs.length) {
                await Notification.insertMany(notifDocs);
            }
        } else {
            logger.warn(`[ReminderScheduler] Reminder ${reminderId}: no FCM tokens found`);
        }

        // Update DB
        const newFireCount = (reminder.fires_sent || 0) + 1;
        const isLast = newFireCount >= (reminder.repeat_count || 1);

        await Reminder.findByIdAndUpdate(reminderId, {
            fires_sent: newFireCount,
            status: isLast ? 'completed' : 'active'
        });

        // Schedule next fire if any remain
        if (!isLast) {
            const updated = {
                _id: reminder._id,
                scheduled_at: reminder.scheduled_at,
                repeat_count: reminder.repeat_count,
                repeat_interval_min: reminder.repeat_interval_min,
                fires_sent: newFireCount,
                status: 'active',
                target_type: reminder.target_type,
                pilgrim_id: reminder.pilgrim_id,
                group_id: reminder.group_id
            };
            scheduleNext(updated);
        }

    } catch (err) {
        logger.error(`[ReminderScheduler] _fire error for ${reminderId}:`, err);
    }
}

module.exports = { init, add, cancel };
