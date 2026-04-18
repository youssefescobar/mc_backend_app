const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI).then(async () => {
    const Group = require('./models/group_model');
    const User = require('./models/user_model');

    console.log('=== GROUP DETAILS ===');
    const groups = await Group.find({}).lean();
    for (const g of groups) {
        console.log(`\nGroup: "${g.group_name}" (${g._id})`);
        
        console.log('  MODERATORS (moderator_ids):');
        for (const mid of (g.moderator_ids || [])) {
            const u = await User.findById(mid).select('full_name user_type fcm_token').lean();
            console.log(`    → ${u?.full_name ?? 'NOT FOUND'} | type: ${u?.user_type} | FCM: ${u?.fcm_token ? 'YES' : 'NO'}`);
        }
        const creator = await User.findById(g.created_by).select('full_name user_type fcm_token').lean();
        console.log(`  CREATOR (created_by): ${creator?.full_name ?? 'NOT FOUND'} | type: ${creator?.user_type} | FCM: ${creator?.fcm_token ? 'YES' : 'NO'}`);

        console.log('  PILGRIMS (pilgrim_ids):');
        for (const pid of (g.pilgrim_ids || [])) {
            const u = await User.findById(pid).select('full_name user_type fcm_token').lean();
            console.log(`    → ${u?.full_name ?? 'NOT FOUND'} | type: ${u?.user_type} | FCM: ${u?.fcm_token ? 'YES (' + u.fcm_token.substring(0,25) + '...)' : 'NO ← PROBLEM'}`);
        }
    }

    mongoose.disconnect();
}).catch(e => console.error(e));
