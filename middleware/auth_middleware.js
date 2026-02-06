const jwt = require('jsonwebtoken');
const User = require('../models/user_model');

// Verifies the user is logged in
const protect = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Not authorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch full user details (excluding password)
        let user = await User.findById(decoded.id).select('-password');

        if (!user) {
            // Check Pilgrim collection (legacy or separate pilgrims)
            const Pilgrim = require('../models/pilgrim_model');
            user = await Pilgrim.findById(decoded.id).select('-password');
            if (user) {
                // Ensure role is set for authorization checks
                user.role = 'pilgrim';
            }
        }

        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error("Auth middleware error:", error);
        res.status(401).json({ message: "Invalid token" });
    }
};

// Counter-measure: Only allows specific roles to pass
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};

const verifyAdmin = authorize('admin');

module.exports = {
    protect,
    authorize,
    verifyToken: protect,
    verifyAdmin
};