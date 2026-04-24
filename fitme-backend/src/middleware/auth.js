const { verifyToken, extractTokenFromHeader } = require('../utils/jwt');
const User = require('../api/user/user.model');

const authenticate = async (req, res, next) => {
  try {
    const token = extractTokenFromHeader(req.header('Authorization'));

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const decoded = verifyToken(token);

    if (decoded.type !== 'access') {
      return res.status(401).json({ success: false, message: 'Invalid token type.' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Token is valid but user not found.' });
    }

    req.user = user;
    req.userId = user._id;
    req.token = token;
    next();
  } catch (error) {
    if (error.message === 'Token has expired') {
      return res.status(401).json({ success: false, message: 'Token has expired. Please login again.', code: 'TOKEN_EXPIRED' });
    }
    if (error.message === 'Invalid token') {
      return res.status(401).json({ success: false, message: 'Invalid token. Please login again.', code: 'INVALID_TOKEN' });
    }
    return res.status(401).json({ success: false, message: 'Authentication failed.', code: 'AUTH_FAILED' });
  }
};

const validateRefreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token is required.' });
    }

    const decoded = verifyToken(refreshToken);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, message: 'Invalid refresh token type.' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Refresh token is valid but user not found.' });
    }

    req.user = user;
    req.refreshToken = refreshToken;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token.', code: 'INVALID_REFRESH_TOKEN' });
  }
};

module.exports = { authenticate, validateRefreshToken };
