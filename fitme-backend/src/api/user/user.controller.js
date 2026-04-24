const userService = require('./user.service');

module.exports.updateProfile = async (req, res, next) => {
  try {
    const result = await userService.updateProfile(req.userId, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.deleteAccount = async (req, res, next) => {
  try {
    const result = await userService.deleteAccount(req.userId, req.body.password);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getUserStats = async (req, res, next) => {
  try {
    const result = await userService.getUserStats(req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.updateEmail = async (req, res, next) => {
  try {
    const result = await userService.updateEmail(req.userId, req.body);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getPreferences = async (req, res, next) => {
  try {
    const result = await userService.getPreferences(req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.updateProfilePhoto = async (req, res, next) => {
  try {
    const result = await userService.updateProfilePhoto(req.userId, req.body.profilePhoto);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.deleteProfilePhoto = async (req, res, next) => {
  try {
    const result = await userService.deleteProfilePhoto(req.userId);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};
