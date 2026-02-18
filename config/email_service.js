const nodemailer = require('nodemailer');
const { logger } = require('./logger');

// Create transporter with Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify SMTP connection on startup
transporter.verify()
    .then(() => {
        logger.info(`✅ Gmail SMTP connection verified: ${process.env.EMAIL_USER}`);
    })
    .catch((error) => {
        logger.error(`❌ Gmail SMTP connection FAILED: ${error.message}`);
    });

// Generate 6-digit verification code
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send verification email
const sendVerificationEmail = async (to, code, fullName) => {
    const mailOptions = {
        from: `"Munawwara Care" <${process.env.EMAIL_USER}>`,
        to,
        subject: 'Verify Your Email - Munawwara Care',
        html: `
            <!DOCTYPE html>
            <html>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td align="center" style="padding: 40px 0;">
                            <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                                <!-- Header -->
                                <tr>
                                    <td style="padding: 40px 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                                        <h1 style="margin: 0; color: #1e40af; font-size: 28px; font-weight: 700;">Munawwara Care</h1>
                                        <p style="margin: 10px 0 0; color: #4b5563; font-size: 14px; opacity: 0.9;">Hajj & Umrah Management System</p>
                                    </td>
                                </tr>
                                <!-- Content -->
                                <tr>
                                    <td style="padding: 40px;">
                                        <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 22px;">Hello ${fullName},</h2>
                                        <p style="margin: 0 0 30px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                            Thank you for registering with Munawwara Care. Please use the verification code below to complete your registration:
                                        </p>
                                        <!-- Code Box -->
                                        <div style="text-align: center; margin: 30px 0;">
                                            <div style="display: inline-block; background-color: #f3f4f6; border: 2px dashed #3b82f6; border-radius: 8px; padding: 20px 40px;">
                                                <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1e40af;">${code}</span>
                                            </div>
                                        </div>
                                        <p style="margin: 30px 0 0; color: #6b7280; font-size: 14px; text-align: center;">
                                            This code will expire in <strong>10 minutes</strong>.
                                        </p>
                                        <p style="margin: 20px 0 0; color: #9ca3af; font-size: 13px; text-align: center;">
                                            If you didn't request this code, please ignore this email.
                                        </p>
                                    </td>
                                </tr>
                                <!-- Footer -->
                                <tr>
                                    <td style="padding: 20px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                                            © ${new Date().getFullYear()} Munawwara Care. All rights reserved.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `
    };

    try {
        const result = await transporter.sendMail(mailOptions);
        logger.info(`Verification email sent to: ${to} (Message ID: ${result.messageId})`);
        return result;
    } catch (error) {
        logger.error(`Failed to send verification email to ${to}: ${error.message}`);
        throw error;
    }
};

// Send group invitation email
const sendGroupInvitationEmail = async (to, inviterName, groupName, frontendUrl) => {
    const mailOptions = {
        from: `"Munawwara Care" <${process.env.EMAIL_USER}>`,
        to,
        subject: `You've been invited to join a group - Munawwara Care`,
        html: `
            <!DOCTYPE html>
            <html>
            <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td align="center" style="padding: 40px 0;">
                            <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                                <!-- Header -->
                                <tr>
                                    <td style="padding: 40px 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                                        <h1 style="margin: 0; color: #1e40af; font-size: 28px; font-weight: 700;">Munawwara Care</h1>
                                        <p style="margin: 10px 0 0; color: #4b5563; font-size: 14px; opacity: 0.9;">Hajj & Umrah Management System</p>
                                    </td>
                                </tr>
                                <!-- Content -->
                                <tr>
                                    <td style="padding: 40px;">
                                        <h2 style="margin: 0 0 20px; color: #1f2937; font-size: 22px;">You've been invited!</h2>
                                        <p style="margin: 0 0 20px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                                            <strong>${inviterName}</strong> has invited you to join as a moderator for the group:
                                        </p>
                                        <!-- Group Name Box -->
                                        <div style="text-align: center; margin: 30px 0;">
                                            <div style="display: inline-block; text-align: center;">
                                                <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 15px 30px; margin-top: 10px;">
                                                    <span style="font-size: 20px; font-weight: 600; color: #1e40af;">${groupName}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <p style="margin: 20px 0 30px; color: #4b5563; font-size: 16px; line-height: 1.6; text-align: center;">
                                            Log in to your Munawwara Care dashboard to accept or decline this invitation.
                                        </p>
                                        <!-- CTA Button -->
                                        <div style="text-align: center;">
                                            <a href="${frontendUrl}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                                                View Invitation
                                            </a>
                                        </div>
                                        <p style="margin: 30px 0 0; color: #9ca3af; font-size: 13px; text-align: center;">
                                            This invitation will expire in <strong>7 days</strong>.
                                        </p>
                                    </td>
                                </tr>
                                <!-- Footer -->
                                <tr>
                                    <td style="padding: 20px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                                            © ${new Date().getFullYear()} Munawwara Care. All rights reserved.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `
    };

    try {
        const result = await transporter.sendMail(mailOptions);
        logger.info(`Group Invitation email sent to: ${to}`);
        return result;
    } catch (error) {
        logger.error(`Failed to send group invitation email to ${to}: ${error.message}`);
        throw error;
    }
};

const sendPilgrimInvitationEmail = async (to, inviterName, groupName, deepLink) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: `Join "${groupName}" on Munawwara Care`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #2563eb; margin: 0;">Munawwara Care</h1>
                    <p style="color: #666; margin-top: 5px;">Hajj & Umrah Companion</p>
                </div>
                
                <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <h2 style="color: #1e40af; margin-top: 0;">You've been invited!</h2>
                    
                    <p style="font-size: 16px; line-height: 1.5;">Hello,</p>
                    <p style="font-size: 16px; line-height: 1.5;">
                        <strong>${inviterName}</strong> has invited you to join the group <strong>"${groupName}"</strong> as a pilgrim.
                    </p>
                    
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${deepLink}" style="background-color: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                            Join Group Now
                        </a>
                        <p style="font-size: 12px; color: #888; margin-top: 15px;">
                            (Tap this button on your mobile phone to open the app)
                        </p>
                    </div>
                
                    <p style="font-size: 14px; color: #666; border-top: 1px solid #eee; padding-top: 20px;">
                        If the button above doesn't work, ensure you have the <strong>Munawwara Care</strong> app installed on your phone.
                    </p>
                </div>
                
                <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
                    <p>&copy; ${new Date().getFullYear()} Munawwara Care. All rights reserved.</p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        logger.info(`Pilgrim invitation email sent to ${to}`);
    } catch (error) {
        logger.error(`Error sending pilgrim invitation email to ${to}: ${error.message}`);
        throw error;
    }
};

module.exports = {
    generateVerificationCode,
    sendVerificationEmail,
    sendGroupInvitationEmail,
    sendPilgrimInvitationEmail
};
