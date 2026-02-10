require('dotenv').config();
const { sendVerificationEmail, sendGroupInvitationEmail, sendPilgrimInvitationEmail } = require('./config/email_service');

const targetEmail = 'youssef.hussain9000@gmail.com';

async function sendTestEmails() {
    console.log(`\n📧 Sending test emails to ${targetEmail}...\n`);

    try {
        console.log('1️⃣  Sending Verification Email...');
        await sendVerificationEmail(targetEmail, '123456', 'Youssef Hussain');
        console.log('✅ Verification Email Sent\n');

        console.log('2️⃣  Sending Group Invitation Email...');
        await sendGroupInvitationEmail(targetEmail, 'Admin User', 'Test Group', 'http://localhost:3000', null);
        console.log('✅ Group Invitation Email Sent\n');

        console.log('3️⃣  Sending Pilgrim Invitation Email...');
        await sendPilgrimInvitationEmail(targetEmail, 'Admin User', 'Test Group', 'munawwaracare://join/123');
        console.log('✅ Pilgrim Invitation Email Sent\n');

        console.log('🎉 All test emails sent successfully! Check your inbox.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error sending emails:', error);
        process.exit(1);
    }
}

sendTestEmails();
