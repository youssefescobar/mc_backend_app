const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
    const R = require('./models/reminder_model');
    const User = require('./models/user_model');

    // Latest reminders
    const reminders = await R.find({}).sort({ createdAt: -1 }).limit(5).lean();
    console.log('=== LATEST REMINDERS ===');
    reminders.forEach(r => {
        console.log(`text: "${r.text}" | status: ${r.status} | fires_sent: ${r.fires_sent}/${r.repeat_count} | group_ids: ${JSON.stringify(r.group_ids)} | scheduled_at: ${r.scheduled_at}`);
    });

    // All users with FCM tokens
    console.log('\n=== ALL USERS ===');
    const users = await User.find({}).select('full_name role fcm_token').lean();
    if (users.length === 0) {
        console.log('NO users found!');
    } else {
        users.forEach(u => {
            const tokenStatus = u.fcm_token ? `HAS TOKEN: ${u.fcm_token.substring(0, 35)}...` : 'NO TOKEN';
            console.log(`name: ${u.full_name} | role: ${u.role} | fcm: ${tokenStatus}`);
        });
    }

    mongoose.disconnect();
}).catch(e => console.error(e));
