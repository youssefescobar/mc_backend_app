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
const { translateText } = require('./translationService');
const Notification = require('../models/notification_model');

/** ms threshold: fire immediately if we're within this window past due */
const OVERDUE_GRACE_MS = 10 * 60 * 1000; // 10 minutes

/** Dart weekday 1=Mon…7=Sun → JS Date.getUTCDay() 0=Sun…6=Sat */
function dartWeekdayToUtcJsDay(d) {
    const n = parseInt(d, 10);
    if (n === 7) return 0;
    return n;
}

/**
 * Next UTC instant >= fromMs using anchor's UTC time-of-day on a day whose weekday is in weeklyDartDays (1–7).
 */
function nextWeeklyOccurrenceMs(anchorScheduledAt, weeklyDartDays, fromMs) {
    if (!weeklyDartDays || weeklyDartDays.length === 0) return null;
    const anchor = new Date(anchorScheduledAt);
    const h = anchor.getUTCHours();
    const mi = anchor.getUTCMinutes();
    const s = anchor.getUTCSeconds();
    const ms = anchor.getUTCMilliseconds();
    const targetJsDays = new Set(weeklyDartDays.map(dartWeekdayToUtcJsDay));
    const from = new Date(fromMs);
    for (let delta = 0; delta < 400; delta++) {
        const cand = new Date(Date.UTC(
            from.getUTCFullYear(),
            from.getUTCMonth(),
            from.getUTCDate() + delta,
            h, mi, s, ms
        ));
        if (cand.getTime() < fromMs) continue;
        if (targetJsDays.has(cand.getUTCDay())) return cand.getTime();
    }
    return null;
}

/** Map of reminderId (string) → active timeout handle(s) */
const _handles = new Map();

/** Socket.IO server — set in init() for notification_refresh after DB inserts */
let _io = null;

function emitNotificationRefreshToUsers(userIds) {
    if (!_io || !userIds?.length) return;
    const seen = new Set();
    for (const id of userIds) {
        const key = id?.toString?.() ?? String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        _io.to(`user_${key}`).emit('notification_refresh');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call once at server startup. Loads all non-terminal reminders from DB
 * and schedules their next fire.
 * @param {import('socket.io').Server | null} io - optional; used to emit notification_refresh
 */
async function init(io) {
    _io = io || null;
    const Reminder = require('../models/reminder_model');
    try {
        const reminders = await Reminder.find({
            status: { $in: ['pending', 'active'] }
        }, null, { sanitizeFilter: false });
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
    const weeklyDays = reminder.weekly_days;
    const hasWeekly = weeklyDays && weeklyDays.length > 0;

    if (fireCount >= totalFires) {
        if (reminder.is_daily && !hasWeekly) {
            // Daily recurrence: schedule for the same time tomorrow
            const nextDay = new Date(reminder.scheduled_at);
            nextDay.setDate(nextDay.getDate() + 1);

            Reminder.findByIdAndUpdate(key, {
                scheduled_at: nextDay,
                fires_sent: 0,
                status: 'pending'
            }, { new: true }).then(updated => {
                if (updated) scheduleNext(updated);
            }).catch(err => logger.error(`[ReminderScheduler] Error updating daily reminder ${key}:`, err));
            return;
        }
        // Already done — mark completed if not already
        Reminder.findByIdAndUpdate(key, { status: 'completed' }).catch(() => {});
        return;
    }

    let nextFireAt;
    if (hasWeekly) {
        const fromMs = fireCount === 0
            ? Math.max(now, new Date(reminder.scheduled_at).getTime())
            : now + 500;
        const nextMs = nextWeeklyOccurrenceMs(reminder.scheduled_at, weeklyDays, fromMs);
        if (nextMs == null) {
            logger.error(`[ReminderScheduler] No weekly slot for reminder ${key}`);
            Reminder.findByIdAndUpdate(key, { status: 'completed' }).catch(() => {});
            return;
        }
        nextFireAt = nextMs;
    } else {
        const firstFire = new Date(reminder.scheduled_at).getTime();
        const intervalMs = (reminder.repeat_interval_min || 15) * 60 * 1000;
        nextFireAt = firstFire + fireCount * intervalMs;
    }

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

        // Fetch all target pilgrims: _id + fcm_token + language
        // We need _id for notification DB records, fcm_token for push, language for translation
        let allRecipients = []; // { _id, fcm_token, language }

        if (reminder.target_type === 'pilgrim' && reminder.pilgrim_id) {
            const pilgrim = await User.findById(reminder.pilgrim_id).select('_id fcm_token language');
            if (pilgrim) {
                allRecipients = [{ _id: pilgrim._id, fcm_token: pilgrim.fcm_token || null, language: pilgrim.language || 'en' }];
            }
        } else if (reminder.target_type === 'system') {
            // All app pilgrims (schema field is user_type, not virtual role)
            const pilgrims = await User.find({ user_type: 'pilgrim' }).select('_id fcm_token language');
            allRecipients = pilgrims.map(p => ({
                _id: p._id,
                fcm_token: p.fcm_token || null,
                language: p.language || 'en'
            }));
        } else {
            // target_type === 'group' | 'all_groups' — resolve group IDs then member pilgrims
            let targetGroupIds = [];
            if (reminder.target_type === 'all_groups') {
                if (reminder.group_ids && reminder.group_ids.length > 0) {
                    targetGroupIds = reminder.group_ids;
                } else {
                    const allGroups = await Group.find({}).select('_id');
                    targetGroupIds = allGroups.map(g => g._id);
                }
            } else {
                targetGroupIds = reminder.group_ids && reminder.group_ids.length > 0
                    ? reminder.group_ids
                    : (reminder.group_id ? [reminder.group_id] : []);
            }

            if (targetGroupIds.length > 0) {
                const groups = await Group.find({ _id: { $in: targetGroupIds } }).select('pilgrim_ids');
                const uniquePilgrimIds = [...new Set(groups.flatMap(g => g.pilgrim_ids || []))];

                if (uniquePilgrimIds.length > 0) {
                    const pilgrims = await User.find({ _id: { $in: uniquePilgrimIds } }).select('_id fcm_token language');
                    allRecipients = pilgrims.map(p => ({
                        _id: p._id,
                        fcm_token: p.fcm_token || null,
                        language: p.language || 'en'
                    }));
                }
            }
        }

        if (allRecipients.length > 0) {
            // Translate once per unique language (covers both push and DB records)
            const uniqueLangs = [...new Set(allRecipients.map(r => r.language))];
            const translationsByLang = {};
            await Promise.all(uniqueLangs.map(async (lang) => {
                const [translatedTitle, translatedText] = await Promise.all([
                    translateText(reminder.title || 'Reminder', lang),
                    translateText(reminder.text, lang)
                ]);
                translationsByLang[lang] = { translatedTitle, translatedText };
            }));

            // --- FCM push: only recipients with a token, grouped by language ---
            const fcmByLang = {};
            for (const r of allRecipients.filter(r => r.fcm_token)) {
                if (!fcmByLang[r.language]) fcmByLang[r.language] = [];
                fcmByLang[r.language].push(r.fcm_token);
            }

            await Promise.all(Object.entries(fcmByLang).map(([lang, tokens]) => {
                const { translatedTitle, translatedText } = translationsByLang[lang];
                return sendPushNotification(
                    tokens,
                    translatedTitle,
                    translatedText,
                    {
                        type: 'urgent',
                        messageType: 'reminder_tts',
                        body: translatedText,
                        reminderId: reminderId,
                        scheduledAt: new Date().toISOString()
                    },
                    reminder.is_urgent || false // isUrgent = true → data-only, background handler does sound+TTS
                );
            }));

            const fcmCount = allRecipients.filter(r => r.fcm_token).length;
            logger.info(`[ReminderScheduler] ✓ Reminder ${reminderId} fire #${reminder.fires_sent + 1} — FCM sent to ${fcmCount}/${allRecipients.length} device(s)`);

            // --- DB notification records: one per user, each in their own language ---
            const targetGroupIdForNotif = (reminder.group_ids && reminder.group_ids.length > 0)
                ? reminder.group_ids[0]
                : reminder.group_id;

            const notifDocs = allRecipients.map(r => {
                const { translatedTitle, translatedText } = translationsByLang[r.language];
                return {
                    user_id: r._id,
                    type: 'reminder',
                    title: translatedTitle,
                    message: translatedText,
                    data: { group_id: targetGroupIdForNotif }
                };
            });
            if (notifDocs.length) {
                await Notification.insertMany(notifDocs);
                emitNotificationRefreshToUsers(allRecipients.map(r => r._id));
            }
        } else {
            logger.warn(`[ReminderScheduler] Reminder ${reminderId}: no recipients found`);
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
                group_id: reminder.group_id,
                group_ids: reminder.group_ids,
                is_daily: reminder.is_daily,
                weekly_days: reminder.weekly_days
            };
            scheduleNext(updated);
        }

    } catch (err) {
        logger.error(`[ReminderScheduler] _fire error for ${reminderId}:`, err);
    }
}

module.exports = { init, add, cancel };
