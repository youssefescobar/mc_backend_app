const jwt = require('jsonwebtoken');
const User = require('../models/user_model');

// Verifies the user is logged in
const protect = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Not authorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach decoded token data to req.user
        // This includes id and role, avoiding unnecessary database lookups
        req.user = {
            id: decoded.id,
            role: decoded.role
        };

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