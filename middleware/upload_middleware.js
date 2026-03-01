const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { logger } = require('../config/logger');

// Allowed file extensions (whitelist)
const ALLOWED_EXTENSIONS = {
    image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.opus']
};

// File signature validation (magic numbers) for additional security
const FILE_SIGNATURES = {
    // Images
    'ffd8ff': 'jpg',
    '89504e47': 'png',
    '47494638': 'gif',
    '52494646': 'webp', // RIFF header (used by WebP and WAV)
    // Audio
    '494433': 'mp3', // ID3
    'fffb': 'mp3',   // MP3 without ID3
    'fff3': 'mp3',   // MP3 without ID3
    '664c6143': 'flac',
    '4f676753': 'ogg'
};

// Absolute path to uploads directory
const uploadDir = path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists with proper permissions
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
    logger.info(`Created uploads directory: ${uploadDir}`);
}

/**
 * Sanitize filename to prevent path traversal attacks
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
    // Remove directory traversal patterns and special characters
    return filename
        .replace(/\.\./g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .substring(0, 100); // Limit length
}

/**
 * Validate file extension against whitelist
 * @param {string} filename - Filename with extension
 * @returns {boolean} True if extension is allowed
 */
function isAllowedExtension(filename) {
    const ext = path.extname(filename).toLowerCase();
    const allAllowed = [...ALLOWED_EXTENSIONS.image, ...ALLOWED_EXTENSIONS.audio];
    return allAllowed.includes(ext);
}

/**
 * Validate file signature (magic numbers)
 * @param {Buffer} buffer - File buffer (first few bytes)
 * @returns {boolean} True if signature matches known safe file types
 */
function validateFileSignature(buffer) {
    if (!buffer || buffer.length < 4) return false;
    
    const hex = buffer.toString('hex', 0, 8);
    
    // Check against known signatures
    for (const signature of Object.keys(FILE_SIGNATURES)) {
        if (hex.startsWith(signature)) {
            return true;
        }
    }
    
    // WAV files have RIFF header, check for WAVE format
    if (hex.startsWith('52494646') && buffer.length >= 12) {
        const waveHeader = buffer.toString('hex', 8, 12);
        if (waveHeader === '57415645') return true; // 'WAVE'
    }
    
    return false;
}

/**
 * Configure multer storage with secure filename generation
 */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        try {
            // Sanitize original filename
            const sanitized = sanitizeFilename(file.originalname);
            const ext = path.extname(sanitized).toLowerCase();
            
            // Generate cryptographically secure random filename
            const randomBytes = crypto.randomBytes(16).toString('hex');
            const timestamp = Date.now();
            const filename = `${file.fieldname}-${timestamp}-${randomBytes}${ext}`;
            
            logger.debug(`Upload filename generated: ${filename} (original: ${file.originalname})`);
            cb(null, filename);
        } catch (error) {
            logger.error(`Filename generation error: ${error.message}`);
            cb(error);
        }
    }
});

/**
 * Multer file filter with comprehensive validation
 */
const fileFilter = (req, file, cb) => {
    try {
        // Validate MIME type
        const isImage = file.mimetype.startsWith('image/');
        const isAudio = file.mimetype.startsWith('audio/');
        
        if (!isImage && !isAudio) {
            logger.warn(`Rejected file with invalid MIME type: ${file.mimetype} from user ${req.user?.id}`);
            return cb(new Error('Only image and audio files are allowed'), false);
        }
        
        // Validate file extension
        if (!isAllowedExtension(file.originalname)) {
            const ext = path.extname(file.originalname);
            logger.warn(`Rejected file with invalid extension: ${ext} from user ${req.user?.id}`);
            return cb(new Error(`File extension ${ext} is not allowed`), false);
        }
        
        logger.debug(`File filter passed for: ${file.originalname} (${file.mimetype})`);
        cb(null, true);
    } catch (error) {
        logger.error(`File filter error: ${error.message}`);
        cb(error, false);
    }
};

/**
 * Multer configuration with security settings
 */
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 1, // Only allow 1 file per request
        fields: 10, // Limit form fields
        parts: 20 // Limit total parts
    }
});

/**
 * Middleware to validate file signature after upload
 * Add this after multer middleware in routes: upload.single('file'), validateUploadedFile
 */
const validateUploadedFile = (req, res, next) => {
    if (!req.file) {
        return next();
    }
    
    try {
        const filePath = req.file.path;
        const buffer = Buffer.alloc(12);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, 12, 0);
        fs.closeSync(fd);
        
        if (!validateFileSignature(buffer)) {
            // Delete invalid file
            fs.unlinkSync(filePath);
            logger.warn(`Deleted file with invalid signature: ${req.file.filename} from user ${req.user?.id}`);
            return res.status(400).json({ 
                success: false,
                message: 'Invalid file format. File signature does not match expected type.' 
            });
        }
        
        logger.info(`File uploaded successfully: ${req.file.filename} by user ${req.user?.id}`);
        next();
    } catch (error) {
        logger.error(`File signature validation error: ${error.message}`);
        // Clean up file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false,
            message: 'File validation failed' 
        });
    }
};

module.exports = upload;
module.exports.validateUploadedFile = validateUploadedFile;
module.exports.ALLOWED_EXTENSIONS = ALLOWED_EXTENSIONS;
