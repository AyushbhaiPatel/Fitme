const authService = require('./auth.service');

module.exports.register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.refreshToken = async (req, res, next) => {
  try {
    const result = await authService.refreshToken(req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.logout = async (req, res, next) => {
  try {
    const result = await authService.logout();
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getMe = async (req, res, next) => {
  try {
    const result = await authService.getMe(req.userId || req.user._id);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.changePassword = async (req, res, next) => {
  try {
    const result = await authService.changePassword(req.userId || req.user._id, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.verifyToken = async (req, res, next) => {
  try {
    const result = await authService.verifyToken(req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.sendOTP = async (req, res, next) => {
  try {
    const result = await authService.sendOTP(req.body.email);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.verifyOTP = async (req, res, next) => {
  try {
    const result = await authService.verifyOTP(req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.resendOTP = async (req, res, next) => {
  try {
    const result = await authService.resendOTP(req.body.email);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.requestPasswordReset = async (req, res, next) => {
  try {
    const result = await authService.requestPasswordReset(req.body.email);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.resetPasswordWithOTP = async (req, res, next) => {
  try {
    const result = await authService.resetPasswordWithOTP(req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};
