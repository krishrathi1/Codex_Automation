import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {
        // Production: structured JSON (SigNoz-compatible)
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        // Development: human-readable
        transport: {
          target: 'pino/file',
          options: { destination: 1 }, // stdout
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

export default logger;
