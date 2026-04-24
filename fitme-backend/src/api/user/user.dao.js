const User = require('./user.model');

module.exports.findById = (id) => User.findById(id);

module.exports.findByIdWithPassword = (id) => User.findById(id).select('+password');

module.exports.findByUsername = (username, excludeId) =>
  User.findOne({ username, _id: { $ne: excludeId } });

module.exports.findByEmail = (email, excludeId) =>
  User.findOne({ email, _id: { $ne: excludeId } });

module.exports.updateById = (id, data, options = { new: true, runValidators: true }) =>
  User.findByIdAndUpdate(id, data, options);

module.exports.deleteById = (id) => User.findByIdAndDelete(id);

module.exports.saveUser = (user) => user.save();
