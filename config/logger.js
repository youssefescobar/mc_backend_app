const winston = require('winston');

const { combine, timestamp, printf, colorize, align, errors } = winston.format;

// Custom log format
const log_format = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }), // Print stack trace
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    align(),
    log_format
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

// Middleware for logging HTTP requests
const http_logger = (req, res, next) => {
  const start_time = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start_time;
    const { method, originalUrl } = req;
    const { statusCode } = res;
    let message = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;

    if (statusCode >= 400) {
      // Include request body in error logs
      if (req.body && Object.keys(req.body).length > 0) {
        message += ` Body: ${JSON.stringify(req.body)}`;
      }
      logger.error(message);
    } else {
      logger.info(message);
    }
  });
  next();
};

module.exports = { logger, http_logger };
