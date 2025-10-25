const { Format } = require('../../config/format');
const gemini = require('../../config/gemini');
const aicoachDao = require('./aicoach.dao');

const cleanResponseText = (text) => {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
    .replace(/```[\w]*\n?/g, '').replace(/```/g, '').replace(/`/g, '')
    .replace(/^\s*[-*+]\s/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
};

const buildSystemPrompt = (user) => {
  const name = user.firstName || 'there';
  const goals = Array.isArray(user.fitnessGoals) ? user.fitnessGoals.join(', ') : 'general fitness';
  const experience = user.fitnessExperience || 'beginner';
  const diet = user.dietaryPreference || 'No Restrictions';
  const frequency = user.workoutFrequency || 'not specified';
  const workouts = user.preferredWorkouts
    ? (Array.isArray(user.preferredWorkouts) ? user.preferredWorkouts.join(', ') : user.preferredWorkouts)
    : 'various';

  return `You are an AI Fitness Coach for FitMe+. Be helpful, encouraging, and provide personalized advice.

User Profile:
- Name: ${name}
- Goals: ${goals}
- Experience: ${experience}
- Diet: ${diet}
- Workout Frequency: ${frequency}
- Preferred Workouts: ${workouts}

Guidelines:
- Be supportive and motivational
- Provide evidence-based advice
- Help with workouts, nutrition, recipes, and app usage
- Use emojis appropriately
- Keep responses concise but helpful
- Do NOT use markdown formatting
- Write in plain text only
- End responses naturally

Respond to the user's message below.`;
};

const generateRecipes = async (query, user) => {
  try {
    const goals = Array.isArray(user.fitnessGoals) ? user.fitnessGoals.join(', ') : 'general fitness';
    const diet = user.dietaryPreference || 'No Restrictions';

    const prompt = `Generate 2 healthy recipes related to: "${query}"

User preferences:
- Dietary: ${diet}
- Goals: ${goals}

Return ONLY a valid JSON array:
[
  {
    "name": "Recipe Name",
    "description": "Brief description",
    "prepTime": "X minutes",
    "cookTime": "Y minutes",
    "calories": "per serving",
    "protein": "Xg",
    "carbs": "Yg",
    "fat": "Zg",
    "ingredients": ["ingredient 1"],
    "instructions": ["step 1"],
    "tags": ["healthy"]
  }
]`;

    const text = await gemini.generateContent(prompt, { maxOutputTokens: 4096, thinkingLevel: 'minimal' }, { label: 'aicoach' });
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : null;
  } catch (err) {
    console.error('Recipe generation error:', err.message);
    return null;
  }
};

// Maps a Gemini failure to the chat error contract: { code, success:false, message, errorCode }.
const mapProviderError = (err) => {
  if (gemini.isRateLimitError(err)) {
    const res = { code: 429, success: false, message: 'The AI coach is busy right now. Please try again in a moment.', errorCode: 'AI_RATE_LIMITED' };
    const retryAfter = gemini.getRetryAfterSeconds(err);
    if (retryAfter) res.retryAfter = retryAfter;
    return res;
  }
  if (gemini.isAuthError(err)) {
    return { code: 503, success: false, message: 'The AI coach is temporarily unavailable.', errorCode: 'AI_AUTH_ERROR' };
  }
  return { code: 502, success: false, message: 'The AI coach could not generate a response. Please try again.', errorCode: 'AI_PROVIDER_ERROR' };
};

module.exports.chat = async (message, conversationHistory, user) => {
  if (!message || message.trim().length === 0) {
    return { ...Format.badRequest('Message is required'), errorCode: 'BAD_REQUEST' };
  }

  if (!gemini.isAvailable()) {
    return { code: 503, success: false, message: 'AI service not configured', errorCode: 'AI_NOT_CONFIGURED' };
  }

  const systemPrompt = buildSystemPrompt(user);
  let context = systemPrompt + '\n\n';
  (conversationHistory || []).slice(-6).forEach((msg) => {
    context += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
  });
  context += `User: ${message}\nAssistant:`;

  let cleaned;
  try {
    const rawResponse = await gemini.generateContent(context, { maxOutputTokens: 2048, thinkingLevel: 'minimal' }, { label: 'aicoach' });
    cleaned = cleanResponseText(rawResponse);
  } catch (err) {
    return mapProviderError(err);
  }
  if (!cleaned) {
    console.error('[aicoach] Gemini error: empty response');
    return mapProviderError(new Error('Empty response from Gemini'));
  }

  let recipes = null;
  const lower = message.toLowerCase();
  if (['recipe', 'meal', 'food', 'cook'].some((kw) => lower.includes(kw))) {
    recipes = await generateRecipes(message, user);
  }

  const interaction = await aicoachDao.createInteraction({
    userId: user._id || user.id,
    message,
    response: cleaned,
    recipes,
  });

  return Format.success({
    response: cleaned,
    recipes,
    timestamp: interaction.created_at,
  });
};

module.exports.getSuggestions = (user) => {
  const suggestions = [
    'How do I set up my workout routine?',
    "What's a good beginner workout plan?",
    'Can you suggest healthy recipes for weight loss?',
    'How can I track my nutrition effectively?',
    'What exercises are best for building muscle?',
    'How do I stay motivated with my fitness goals?',
    'Can you create a meal plan for my dietary preferences?',
    "What's the best way to track my progress?",
  ];

  const goals = Array.isArray(user.fitnessGoals) ? user.fitnessGoals : [];
  if (goals.includes('weight-loss')) suggestions.unshift('What are effective weight loss strategies?', 'Can you suggest low-calorie recipes?');
  if (goals.includes('muscle-gain')) suggestions.unshift('How much protein should I eat for muscle gain?', "What's a good strength training routine?");
  if (user.dietaryPreference && user.dietaryPreference !== 'No Restrictions') suggestions.unshift(`Can you suggest ${user.dietaryPreference} recipes?`);

  return Format.success({ suggestions: suggestions.slice(0, 8) });
};

module.exports.healthCheck = async () => {
  return Format.success({
    status: gemini.isAvailable() ? 'healthy' : 'degraded',
    geminiAvailable: gemini.isAvailable(),
    timestamp: new Date().toISOString(),
  });
};
