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

// Initialization
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 10000, // Wait 10s before considering dead (default 20000)
    pingInterval: 5000  // Send ping every 5s (default 25000)
});

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
const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : '*';
app.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
const gracefulShutdown = async () => {
    logger.info('Received shutdown signal, closing server gracefully...');
    
    server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDB();
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);