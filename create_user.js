const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');
require('dotenv').config();

const User = require('./models/user_model');

const args = process.argv.slice(2);

function parseArgs(argv) {
    const parsed = {};

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            continue;
        }

        const key = token.slice(2);
        const next = argv[i + 1];

        if (!next || next.startsWith('--')) {
            parsed[key] = true;
            continue;
        }

        parsed[key] = next;
        i += 1;
    }

    return parsed;
}

function normalizeUserType(value) {
    if (!value) return null;

    const type = String(value).toLowerCase().trim();
    if (type === 'mod') return 'moderator';
    if (type === 'moderator' || type === 'pilgrim') return type;

    return null;
}

function normalizeBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;

    const normalized = String(value).toLowerCase().trim();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;

    return defaultValue;
}

function printHelp() {
    console.log('Usage: node create_user.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --type <pilgrim|moderator|mod>    User type to create');
    console.log('  --name <full name>                Full name');
    console.log('  --email <email>                   Email address');
    console.log('  --password <password>             Plain password');
    console.log('  --phone <phone>                   Phone number');
    console.log('  --national-id <id>                National ID (optional)');
    console.log('  --verified <true|false>           Email verified flag (default: false)');
    console.log('  --active <true|false>             Active flag (default: true)');
    console.log('  --help                            Show this message');
    console.log('');
    console.log('Examples:');
    console.log('  node create_user.js --type pilgrim --name "Ali Ahmed" --email ali@example.com --password 123456 --phone +966500000001 --national-id 1234567890');
    console.log('  node create_user.js --type mod --name "Sara Omar" --email sara@example.com --password 123456 --phone +966500000002 --verified true');
    console.log('');
    console.log('If required values are missing, the script will ask for them interactively.');
}

function askQuestion(rl, question, { required = false, defaultValue = null } = {}) {
    return new Promise((resolve) => {
        const prompt = defaultValue !== null ? `${question} (${defaultValue}): ` : `${question}: `;

        rl.question(prompt, (answer) => {
            const value = answer.trim();

            if (!value && defaultValue !== null) {
                resolve(String(defaultValue));
                return;
            }

            if (required && !value) {
                console.log('This field is required.');
                resolve(askQuestion(rl, question, { required, defaultValue }));
                return;
            }

            resolve(value);
        });
    });
}

async function collectMissingValues(parsedArgs) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        let userType = normalizeUserType(parsedArgs.type);
        while (!userType) {
            const rawType = await askQuestion(rl, 'User type (pilgrim/moderator)', { required: true });
            userType = normalizeUserType(rawType);
            if (!userType) {
                console.log('Invalid user type. Use pilgrim or moderator.');
            }
        }

        const fullName = parsedArgs.name || await askQuestion(rl, 'Full name', { required: true });
        const email = parsedArgs.email || await askQuestion(rl, 'Email', { required: true });
        const password = parsedArgs.password || await askQuestion(rl, 'Password', { required: true });
        const phone = parsedArgs.phone || await askQuestion(rl, 'Phone number', { required: true });
        const nationalId = parsedArgs['national-id'] || await askQuestion(rl, 'National ID (optional)');

        const verifiedValue = parsedArgs.verified !== undefined
            ? parsedArgs.verified
            : await askQuestion(rl, 'Email verified? (true/false)', { defaultValue: 'false' });

        const activeValue = parsedArgs.active !== undefined
            ? parsedArgs.active
            : await askQuestion(rl, 'Active? (true/false)', { defaultValue: 'true' });

        return {
            userType,
            fullName,
            email,
            password,
            phone,
            nationalId,
            emailVerified: normalizeBoolean(verifiedValue, false),
            active: normalizeBoolean(activeValue, true)
        };
    } finally {
        rl.close();
    }
}

async function createUser() {
    if (args.includes('--help')) {
        printHelp();
        return;
    }

    const parsedArgs = parseArgs(args);

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is missing in your .env file.');
        process.exitCode = 1;
        return;
    }

    const input = await collectMissingValues(parsedArgs);

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const duplicateChecks = [
            { email: input.email },
            { phone_number: input.phone }
        ];

        if (input.nationalId) {
            duplicateChecks.push({ national_id: input.nationalId });
        }

        const existingUser = await User.findOne({ $or: duplicateChecks });
        if (existingUser) {
            console.error('User already exists with one of the unique fields:');
            console.error(`- Email: ${existingUser.email}`);
            console.error(`- Phone: ${existingUser.phone_number}`);
            if (existingUser.national_id) {
                console.error(`- National ID: ${existingUser.national_id}`);
            }
            process.exitCode = 1;
            return;
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(input.password, salt);

        const user = new User({
            full_name: input.fullName,
            email: input.email,
            email_verified: input.emailVerified,
            password: hashedPassword,
            national_id: input.nationalId || undefined,
            phone_number: input.phone,
            user_type: input.userType,
            active: input.active
        });

        await user.save();

        console.log('User created successfully');
        console.log('----------------------------------------');
        console.log(`ID:          ${user._id}`);
        console.log(`Name:        ${user.full_name}`);
        console.log(`Email:       ${user.email}`);
        console.log(`Phone:       ${user.phone_number}`);
        console.log(`Type:        ${user.user_type}`);
        console.log(`Active:      ${user.active}`);
        console.log(`Verified:    ${user.email_verified}`);
        console.log('----------------------------------------');
    } catch (error) {
        console.error('Error creating user:', error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
    }
}

createUser();
