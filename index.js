require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require("socket.io");

// Config & Services
const connectDB = require('./config/db');
const { http_logger } = require('./config/logger');
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
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Initialize Sockets
initializeSockets(io);
app.set('socketio', io);

// Middleware
app.use(http_logger); // Log requests first
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

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

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, message: err.message });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));