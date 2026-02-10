const initializeSockets = (io) => {
    io.on('connection', (socket) => {
        console.log(`[Socket] User connected: ${socket.id}`);

        // Join a group room
        socket.on('join_group', (groupId) => {
            if (groupId) {
                socket.join(`group_${groupId}`);
                console.log(`[Socket] User ${socket.id} joined group_${groupId}`);
            }
        });

        // Leave a group room
        socket.on('leave_group', (groupId) => {
            if (groupId) {
                socket.leave(`group_${groupId}`);
                console.log(`[Socket] User ${socket.id} left group_${groupId}`);
            }
        });

        // Handle Location Updates
        socket.on('update_location', (data) => {
            // data Expects: { groupId, pilgrimId, lat, lng, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to others in the group (e.g. moderators)
                socket.to(`group_${groupId}`).emit('location_update', data);
                // console.log(`[Socket] Location update from ${data.pilgrimId}`);
            }
        });

        // Handle SOS Alerts
        socket.on('sos_alert', (data) => {
            // data Expects: { groupId, pilgrimId, message, location, ... }
            const { groupId } = data;
            if (groupId) {
                // Broadcast to everyone in group (so moderators see it immediately)
                io.to(`group_${groupId}`).emit('sos_alert', data);
                console.log(`[Socket] SOS Alert from ${data.pilgrimId} in group_${groupId}`);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] User disconnected: ${socket.id}`);
        });
    });
};

module.exports = { initializeSockets };
