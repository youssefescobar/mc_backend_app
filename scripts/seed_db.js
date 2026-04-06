require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Import Models
const User = require('../models/user_model');
const Group = require('../models/group_model');
const Message = require('../models/message_model');
const Reminder = require('../models/reminder_model');
const Notification = require('../models/notification_model');
const CallHistory = require('../models/call_history_model');

async function seedDatabase() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 10,
            family: 4
        });
        console.log('Connected to MongoDB');

        // Clear existing data
        console.log('Clearing old data...');
        await User.deleteMany({});
        await Group.deleteMany({});
        await Message.deleteMany({});
        await Reminder.deleteMany({});
        await Notification.deleteMany({});
        await CallHistory.deleteMany({});

        const hashedPassword = await bcrypt.hash('password123', 10);

        // 1. Create Admins
        const admin = await User.create({
            full_name: 'Super Admin',
            email: 'admin@munawwaracare.com',
            phone_number: '+10000000000',
            password: hashedPassword,
            user_type: 'admin',
            email_verified: true
        });
        console.log('✅ Admin created');

        // 2. Create Moderators (10)
        const moderators = [];
        for (let i = 1; i <= 10; i++) {
            const mod = await User.create({
                full_name: `Moderator The ${i}th`,
                email: `mod${i}@munawwaracare.com`,
                phone_number: `+111000000${i.toString().padStart(2, '0')}`,
                password: hashedPassword,
                user_type: 'moderator',
                email_verified: true,
                gender: i % 2 === 0 ? 'female' : 'male',
                language: i % 4 === 0 ? 'ar' : 'en',
                current_latitude: 21.4225 + (Math.random() * 0.01),
                current_longitude: 39.8262 + (Math.random() * 0.01),
            });
            moderators.push(mod);
        }
        console.log(`✅ ${moderators.length} Moderators created`);

        // 3. Create Pilgrims (50)
        const pilgrims = [];
        for (let i = 1; i <= 50; i++) {
            const pilgrim = await User.create({
                full_name: `Pilgrim The ${i}th`,
                email: `pilgrim${i}@munawwaracare.com`,
                phone_number: `+122000000${i.toString().padStart(2, '0')}`,
                password: hashedPassword,
                user_type: 'pilgrim',
                email_verified: true,
                national_id: `NAT${10000 + i}`,
                age: 20 + Math.floor(Math.random() * 50), // Random age 20-70
                gender: i % 2 === 0 ? 'female' : 'male',
                language: i % 3 === 0 ? 'ar' : (i % 5 === 0 ? 'ur' : 'en'),
                medical_history: i % 5 === 0 ? 'Diabetic' : 'None',
                current_latitude: 21.4225 + (Math.random() * 0.01), // Near Mecca coords
                current_longitude: 39.8262 + (Math.random() * 0.01),
            });
            pilgrims.push(pilgrim);
        }
        console.log(`✅ ${pilgrims.length} Pilgrims created`);

        // 4. Create Groups (5 groups, each with 2 mods and 10 pilgrims)
        const groups = [];
        for (let i = 0; i < 5; i++) {
            const groupMods = [moderators[i * 2]._id, moderators[(i * 2) + 1]._id];
            const groupPilgrims = pilgrims.slice(i * 10, (i + 1) * 10).map(p => p._id);
            
            const group = await Group.create({
                group_name: `Mecca Caravan ${i + 1}`,
                group_code: `CODE${1000 + i}`,
                moderator_ids: groupMods,
                pilgrim_ids: groupPilgrims,
                created_by: groupMods[0],
                allow_pilgrim_navigation: true
            });
            groups.push(group);
        }
        console.log(`✅ ${groups.length} Groups created`);

        // 5. Create Messages
        let msgCount = 0;
        for (const group of groups) {
            // Generate some texts going back & forth
            const modId = group.moderator_ids[0];
            for (const pilgrimId of group.pilgrim_ids.slice(0, 3)) { // First 3 pilgrims chattin
                await Message.create({
                    group_id: group._id,
                    recipient_id: pilgrimId,
                    sender_id: modId,
                    sender_model: 'User',
                    type: 'text',
                    content: `Hello Pilgrim, please make sure you follow the caravan and stay close.`
                });
                
                await Message.create({
                    group_id: group._id,
                    recipient_id: modId,
                    sender_id: pilgrimId,
                    sender_model: 'User',
                    type: 'text',
                    content: `Understood! I am right behind you.`
                });
                msgCount += 2;
            }
        }
        console.log(`✅ ${msgCount} Messages created`);

        // 6. Create Reminders
        const reminders = [];
        for (const group of groups) {
            const modId = group.moderator_ids[0];
            const reminderDate = new Date();
            reminderDate.setHours(reminderDate.getHours() + 2); // 2 hours from now

            const reminder = await Reminder.create({
                created_by: modId,
                group_ids: [group._id],
                target_type: 'group',
                text: 'Time for Asr Prayer in 15 minutes! Please head back to the main meeting point.',
                scheduled_at: reminderDate,
                repeat_count: 2,
                repeat_interval_min: 10,
                is_daily: false
            });
            reminders.push(reminder);
        }
        console.log(`✅ ${reminders.length} Reminders created`);

        // 7. Create Notifications
        let notifCount = 0;
        for (const group of groups) {
            for (const pilgrimId of group.pilgrim_ids.slice(0, 4)) {
                await Notification.create({
                    user_id: pilgrimId,
                    type: 'group_invitation',
                    title: 'New Group Added',
                    message: `You were added to group ${group.group_name}`,
                    data: { group_id: group._id, group_name: group.group_name }
                });
                notifCount++;
            }
        }
        console.log(`✅ ${notifCount} Notifications created`);

        // 8. Create Call History
        let callCount = 0;
        for (const group of groups) {
            const modId = group.moderator_ids[0];
            for (const pilgrimId of group.pilgrim_ids.slice(0, 2)) {
                
                // Missed call
                await CallHistory.create({
                    caller_id: modId,
                    caller_model: 'User',
                    receiver_id: pilgrimId,
                    receiver_model: 'User',
                    call_type: 'internet',
                    status: 'missed',
                    started_at: new Date(Date.now() - 3600000), // 1 hr ago
                    is_read: false
                });

                // Completed call
                await CallHistory.create({
                    caller_id: pilgrimId,
                    caller_model: 'User',
                    receiver_id: modId,
                    receiver_model: 'User',
                    call_type: 'internet',
                    status: 'completed',
                    duration: 125, // 2 minutes 5 seconds
                    started_at: new Date(Date.now() - 7200000), // 2 hrs ago
                    ended_at: new Date(Date.now() - 7200000 + (125 * 1000)),
                    is_read: true
                });
                callCount += 2;
            }
        }
        console.log(`✅ ${callCount} Call logs created`);

        console.log('\n🎉 Massive Seeding complete! 🎉');
        console.log('Default login for all accounts: password123');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error seeding database:', error);
        process.exit(1);
    }
}

seedDatabase();