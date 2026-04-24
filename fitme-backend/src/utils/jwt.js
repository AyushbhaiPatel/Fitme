const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRE,
    issuer: 'fitness-tracker-api',
    audience: 'fitness-tracker-client',
  });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'fitness-tracker-api',
      audience: 'fitness-tracker-client',
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw new Error('Token has expired');
    if (error.name === 'JsonWebTokenError') throw new Error('Invalid token');
    throw new Error('Token verification failed');
  }
};

const generateAccessToken = (user) => {
  return generateToken({ userId: user._id, email: user.email, username: user.username, type: 'access' });
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user._id, email: user.email, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '30d', issuer: 'fitness-tracker-api', audience: 'fitness-tracker-client' }
  );
};

const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) return null;
  if (authHeader.startsWith('Bearer ')) return authHeader.substring(7).trim();
  return authHeader.trim() || null;
};

module.exports = { generateToken, verifyToken, generateAccessToken, generateRefreshToken, extractTokenFromHeader };
