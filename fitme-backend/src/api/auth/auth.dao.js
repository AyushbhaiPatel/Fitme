const User = require('./auth.model');

module.exports.findByEmail = (email, selectFields = '') => {
  return User.findOne({ email }).select(selectFields);
};

module.exports.findById = (id, selectFields = '') => {
  return User.findById(id).select(selectFields);
};

module.exports.findByUsername = (username) => {
  return User.findOne({ username });
};

module.exports.createUser = (payload) => {
  const user = new User(payload);
  return user.save();
};

module.exports.saveUser = (user) => {
  return user.save();
};
