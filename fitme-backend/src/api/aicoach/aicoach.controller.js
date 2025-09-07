const aicoachService = require('./aicoach.service');

module.exports.chat = async (req, res, next) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const result = await aicoachService.chat(message, conversationHistory, req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.getSuggestions = async (req, res, next) => {
  try {
    const result = await aicoachService.getSuggestions(req.user);
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports.healthCheck = async (req, res, next) => {
  try {
    const result = await aicoachService.healthCheck();
    return res.status(result.code).json(result);
  } catch (error) {
    next(error);
  }
};
