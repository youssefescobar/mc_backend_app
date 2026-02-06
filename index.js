require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const connectDB = require('./config/db');
const { http_logger } = require('./config/logger');
const auth_routes = require('./routes/auth_routes');
const group_routes = require('./routes/group_routes');
const invitation_routes = require('./routes/invitation_routes');
const notification_routes = require('./routes/notification_routes');
const pilgrim_routes = require('./routes/pilgrim_routes');
const admin_routes = require('./routes/admin_routes');

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Logger
app.use(http_logger);

// Database Connection
connectDB();

// Routes
app.use('/api/auth', auth_routes);
app.use('/api/groups', group_routes);
app.use('/api', invitation_routes);
app.use('/api/notifications', notification_routes);
app.use('/api/pilgrim', pilgrim_routes);
app.use('/api/admin', admin_routes);
app.use('/api/messages', require('./routes/message_routes'));

// Error Handling
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
});

app.get('/', (req, res) => res.send("Hajj App Backend Running"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));