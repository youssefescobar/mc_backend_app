const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
    const User = require('./models/user_model');

    console.log('=== FORCE INJECTING FCM TOKEN ===');
    
    // Find the moderator who has a valid FCM token
    const saif = await User.findOne({ user_type: 'moderator', fcm_token: { $ne: null } });
    if (!saif) {
        console.log('❌ Could not find any user with a valid FCM token to copy.');
        mongoose.disconnect();
        return;
    }

    console.log(`Found valid FCM token from: ${saif.full_name}`);

    // Find test2 and inject the token
    const test2 = await User.findOne({ user_type: 'pilgrim', full_name: 'test2' });
    if (!test2) {
        console.log('❌ Could not find pilgrim named "test2".');
        mongoose.disconnect();
        return;
    }

    test2.fcm_token = saif.fcm_token;
    await test2.save();

    console.log(`✅ Copied FCM token to: ${test2.full_name}`);
    console.log(`\n🎉 test2 now has FCM: YES in the database!`);
    console.log(`If you create a reminder now, it WILL fire and be sent to the device holding that token.`);

    mongoose.disconnect();
}).catch(e => console.error(e));
