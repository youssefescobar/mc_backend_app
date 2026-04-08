require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { Server } = require("socket.io");


// Config & Services
const connectDB = require('./config/db');
const { disconnectDB } = require('./config/db');
const { http_logger, logger } = require('./config/logger');
const { initializeSockets } = require('./sockets/socket_manager');
const sanitize_request = require('./middleware/sanitize_middleware');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

// Routes
const auth_routes = require('./routes/auth_routes');
const group_routes = require('./routes/group_routes');
const invitation_routes = require('./routes/invitation_routes');
const notification_routes = require('./routes/notification_routes');
const pilgrim_routes = require('./routes/pilgrim_routes');
const push_notification_routes = require('./routes/push_notification_routes');
const message_routes = require('./routes/message_routes');
const communication_routes = require('./routes/communication_routes');
const call_history_routes = require('./routes/call_history_routes');
const reminder_routes = require('./routes/reminder_routes');

// Initialization
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { 
        origin: process.env.SOCKET_CORS_ORIGINS?.split(',') || ["http://localhost:5173", "http://localhost:4173"],
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 10000,
    pingInterval: 5000
});

// Redis Adapter
const pubClient = new Redis(process.env.REDIS_URL);
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => logger.error('Redis pub error:', err));
subClient.on('error', (err) => logger.error('Redis sub error:', err));

io.adapter(createAdapter(pubClient, subClient));
logger.info('Socket.io Redis adapter connected');

// Initialize Sockets
initializeSockets(io);

app.set('socketio', io);

// Trust proxy - for rate limiting and IP detection when behind reverse proxy
app.set('trust proxy', true);

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(http_logger); // Log requests first

// CORS Configuration
const envOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

const defaultDevOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
];

const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultDevOrigins;

const corsOptions = {
    origin(origin, callback) {
        // Allow requests with no origin (curl/postman/mobile clients)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitize_request);

// Static files
app.use('/uploads', express.static('uploads'));

// Request timeout
app.use((req, res, next) => {
    req.setTimeout(30000); // 30 seconds
    res.setTimeout(30000);
    next();
});

// Database Connection
connectDB();

// Start the reminder scheduler once Mongoose has an open connection.
// Using the 'open' event is reliable even when connectDB retries internally.
const mongoose = require('mongoose');
const { init: initReminderScheduler } = require('./services/reminderScheduler');
mongoose.connection.once('open', () => {
    initReminderScheduler();
});

// Routes Application
app.use('/api/push', push_notification_routes);
app.use('/api/auth', auth_routes);
app.use('/api/groups', group_routes);
app.use('/api', invitation_routes);
app.use('/api/notifications', notification_routes);
app.use('/api/pilgrim', pilgrim_routes);
app.use('/api/messages', message_routes);
app.use('/api/communication', communication_routes);
app.use('/api/call-history', call_history_routes);
app.use('/api/reminders', reminder_routes);

app.get('/', (req, res) => res.send("Hajj App Backend Running"));

// 404 Handler - Must be after all routes
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: `Cannot ${req.method} ${req.path}` 
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    logger.error(`${req.method} ${req.path}:`, err);
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, message: err.message });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful Shutdown
let isShuttingDown = false;

const gracefulShutdown = async ({ signal = 'SIGTERM', forwardSignal = false } = {}) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, closing server gracefully...`);

    server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDB();
        await pubClient.quit();
        await subClient.quit();
        logger.info('Redis adapter disconnected');

        // For nodemon restarts: release resources first, then re-emit signal
        // so nodemon can start the new instance safely.
        if (forwardSignal) {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        if (forwardSignal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown({ signal: 'SIGTERM' }));
process.on('SIGINT', () => gracefulShutdown({ signal: 'SIGINT' }));
process.once('SIGUSR2', () =>
    gracefulShutdown({ signal: 'SIGUSR2', forwardSignal: true }),
);