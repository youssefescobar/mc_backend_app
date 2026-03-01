const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const os = require('os');

const { combine, timestamp, printf, colorize, align, errors, json } = winston.format;

// Environment detection
const isDevelopment = process.env.NODE_ENV !== 'production';

// Sensitive fields to sanitize
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'authorization', 'api_key', 'apiKey'];

// Sanitize sensitive data from objects
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const key in obj) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitized[key] = sanitizeObject(obj[key]);
    } else {
      sanitized[key] = obj[key];
    }
  }
  
  return sanitized;
};

// Custom log format for development
const dev_log_format = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Base format configuration
const baseFormat = combine(
  errors({ stack: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  align()
);

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: {
    environment: process.env.NODE_ENV || 'development',
    hostname: os.hostname(),
    pid: process.pid,
  },
  format: isDevelopment
    ? combine(baseFormat, colorize(), dev_log_format)
    : combine(baseFormat, json()),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

// Add file transports in production or if LOG_TO_FILE is enabled
if (!isDevelopment || process.env.LOG_TO_FILE === 'true') {
  // Combined logs (all levels)
  logger.add(new DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    handleExceptions: true,
    handleRejections: true,
  }));
  
  // Error logs (separate file)
  logger.add(new DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '30d',
    handleExceptions: true,
    handleRejections: true,
  }));
}

// Middleware for logging HTTP requests
const http_logger = (req, res, next) => {
  const start_time = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start_time;
    const { method, originalUrl } = req;
    const { statusCode } = res;
    let message = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;

    if (statusCode >= 400) {
      // Include sanitized request body in error logs (max 500 chars)
      if (req.body && Object.keys(req.body).length > 0) {
        const sanitized = sanitizeObject(req.body);
        const bodyStr = JSON.stringify(sanitized);
        const truncated = bodyStr.length > 500 ? bodyStr.substring(0, 500) + '...' : bodyStr;
        message += ` Body: ${truncated}`;
      }
      logger.error(message);
    } else {
      logger.info(message);
    }
  });
  next();
};

module.exports = { logger, http_logger };
