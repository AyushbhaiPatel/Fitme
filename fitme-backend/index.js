require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const connectDB = require('./src/database/conn');
const apiRoutes = require('./src/api/routes');
const { registerDocsRoute } = require('./src/docs');
const { errorHandler } = require('./src/middleware/error-handler');

const app = express();

// CORS
const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Lets the cross-origin frontend read how long to wait after a 429.
  exposedHeaders: ['Retry-After'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Security
app.use(helmet());
// Global abuse backstop; per-feature limits (e.g. AI chat) live on their routes.
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.', errorCode: 'RATE_LIMITED' },
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', apiRoutes);
registerDocsRoute(app);

app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Fitness Tracker API is running', timestamp: new Date().toISOString() });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler: maps validation/cast/duplicate/body-parser errors to 4xx, else generic 500.
app.use(errorHandler);

// Bootstrap
const PORT = process.env.PORT || 5000;
let server;

const startServer = async () => {
  await connectDB();
  server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  });
};

const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (!server) process.exit(0);
  server.close(() => {
    process.exit(0);
  });
};

// Only boot (DB + listen) when run directly, so tests can require the app.
if (require.main === module) {
  startServer();

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });
}

module.exports = app;
