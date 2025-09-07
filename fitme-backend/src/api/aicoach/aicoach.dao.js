const AICoachInteraction = require('./aicoach.model');

module.exports.createInteraction = (payload) => {
  const interaction = new AICoachInteraction(payload);
  return interaction.save();
};
