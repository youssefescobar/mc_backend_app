/**
 * Database Wipe Script - Clean Start
 * 
 * ⚠️ DANGER: This will DELETE ALL DATA from the database
 * Use only in development environment
 * 
 * Usage:
 *   node wipe_database.js --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { logger } = require('./config/logger');
const connectDB = require('./config/db');

async function wipeDatabase() {
    try {
        logger.warn('🔥 Starting database wipe...');

        // Get all collection names
        const collections = await mongoose.connection.db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        logger.info(`Found ${collectionNames.length} collections to drop:`);
        collectionNames.forEach(name => logger.info(`  - ${name}`));

        // Drop each collection
        let droppedCount = 0;
        for (const collectionName of collectionNames) {
            try {
                await mongoose.connection.db.collection(collectionName).drop();
                logger.info(`✅ Dropped: ${collectionName}`);
                droppedCount++;
            } catch (error) {
                // Collection might not exist or already dropped
                if (error.code === 26) {
                    logger.warn(`  ⚠️  Collection ${collectionName} doesn't exist`);
                } else {
                    logger.error(`  ❌ Failed to drop ${collectionName}: ${error.message}`);
                }
            }
        }

        logger.info(`\n🎉 Database wipe complete!`);
        logger.info(`   Dropped: ${droppedCount}/${collectionNames.length} collections`);
        logger.info(`\n✨ Database is now clean and ready for fresh data`);

        return { success: true, dropped: droppedCount, total: collectionNames.length };

    } catch (error) {
        logger.error(`❌ Database wipe failed: ${error.message}`);
        throw error;
    }
}

// Main execution
if (require.main === module) {
    const runWipe = async () => {
        try {
            // Connect to database
            await connectDB();
            
            const args = process.argv.slice(2);
            
            if (args[0] === '--confirm') {
                console.log('\n⚠️  ⚠️  ⚠️  CRITICAL WARNING ⚠️  ⚠️  ⚠️');
                console.log('╔════════════════════════════════════════╗');
                console.log('║  THIS WILL DELETE ALL DATABASE DATA    ║');
                console.log('║  NO UNDO - NO BACKUP - NO RECOVERY     ║');
                console.log('╚════════════════════════════════════════╝\n');
                
                await wipeDatabase();
                
                console.log('\n🔥 All data has been deleted');
                console.log('🌱 Database is now empty and ready for fresh start\n');
                
                await mongoose.connection.close();
                process.exit(0);
            } else {
                console.log('\n⚠️  Database Wipe Utility');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                console.log('This script will DELETE ALL DATA from the database.');
                console.log('There is NO UNDO and NO BACKUP.\n');
                console.log('Use ONLY in development environment!\n');
                console.log('Usage:');
                console.log('  node wipe_database.js --confirm\n');
                process.exit(1);
            }
        } catch (error) {
            console.error('\n❌ Wipe failed:', error.message);
            process.exit(1);
        }
    };

    runWipe();
}

module.exports = { wipeDatabase };
