require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/user_model');
const Pilgrim = require('./models/pilgrim_model');

const fixActiveStatus = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        const userRes = await User.updateMany({}, { active: true, is_online: false });
        console.log(`Updated Users: ${userRes.modifiedCount}`);

        const pilgrimRes = await Pilgrim.updateMany({}, { active: true, is_online: false });
        console.log(`Updated Pilgrims: ${pilgrimRes.modifiedCount}`);

        console.log('Active status fixed. Exiting...');
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

fixActiveStatus();
