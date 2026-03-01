/**
 * Reset Rate Limits Script
 * 
 * This script resets all rate limit counters by restarting the server.
 * Since we use in-memory rate limiting (express-rate-limit default),
 * the counters are stored in memory and cleared when the server restarts.
 * 
 * Usage:
 *   node reset_rate_limits.js
 * 
 * Note: This script will restart the server if it's running via PM2.
 * If you're running the server manually, just restart it manually.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════╗');
console.log('║     Rate Limit Reset Script                   ║');
console.log('╚════════════════════════════════════════════════╝\n');

// Check if PM2 is being used
exec('pm2 list', (error, stdout, stderr) => {
    if (error) {
        console.log('ℹ️  PM2 is not installed or not running.');
        console.log('\n📝 To reset rate limits:');
        console.log('   1. Stop your server (Ctrl+C if running in terminal)');
        console.log('   2. Start it again with: npm start or npm run dev');
        console.log('\n💡 Rate limits are stored in memory, so restarting clears them.');
        process.exit(0);
    }

    // Check if our app is running in PM2
    if (stdout.includes('mc_backend') || stdout.includes('index')) {
        console.log('✓ PM2 detected. Finding your app...\n');
        
        exec('pm2 restart all', (restartError, restartStdout, restartStderr) => {
            if (restartError) {
                console.error('✗ Failed to restart PM2 apps:', restartError.message);
                process.exit(1);
            }
            
            console.log('✓ Server restarted successfully!');
            console.log('✓ All rate limits have been reset.\n');
            console.log('📊 Rate limit status:');
            console.log('   • Login limiter: Reset (20 requests per 15 min)');
            console.log('   • Register limiter: Reset (10 requests per hour)');
            console.log('   • Auth limiter: Reset (20 requests per 15 min)');
            console.log('   • Search limiter: Reset (30 requests per minute)');
            console.log('   • General limiter: Reset (200 requests per 15 min)\n');
            process.exit(0);
        });
    } else {
        console.log('ℹ️  No apps found in PM2 with typical names.');
        console.log('\n📝 To reset rate limits:');
        console.log('   1. Stop your server (Ctrl+C if running in terminal)');
        console.log('   2. Start it again with: npm start or npm run dev');
        console.log('\n💡 Or if using PM2, run: pm2 restart <app-name>');
        process.exit(0);
    }
});

// Alternative: Create a simple HTTP endpoint version
console.log('\n💡 Alternative: Add a reset endpoint to your server:');
console.log('   Add this to your routes (admin only):');
console.log(`
   router.post('/admin/reset-rate-limits', authorize('admin'), (req, res) => {
       // Rate limits will reset when server restarts
       // Or you can implement custom store reset logic
       res.json({ success: true, message: 'Restart server to reset rate limits' });
   });
`);
