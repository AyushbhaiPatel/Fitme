const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let defaultModel = null;

const initGemini = () => {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY not configured');
    return;
  }
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    defaultModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 8192 },
    });
    console.log('✅ Gemini client initialized');
  } catch (err) {
    console.error('❌ Gemini init failed:', err.message);
  }
};

const getModel = (overrides = {}) => {
  if (!genAI) return null;
  if (Object.keys(overrides).length === 0) return defaultModel;
  return genAI.getGenerativeModel({
    model: overrides.model || 'gemini-2.5-flash',
    generationConfig: {
      temperature: overrides.temperature ?? 0.7,
      topK: overrides.topK ?? 40,
      topP: overrides.topP ?? 0.95,
      maxOutputTokens: overrides.maxOutputTokens ?? 8192,
    },
  });
};

const isAvailable = () => !!defaultModel;

const generateContent = async (prompt, overrides = {}) => {
  const model = getModel(overrides);
  if (!model) throw new Error('Gemini not initialized');
  const result = await model.generateContent(prompt);
  return (await result.response).text();
};

initGemini();

module.exports = { initGemini, getModel, isAvailable, generateContent };
