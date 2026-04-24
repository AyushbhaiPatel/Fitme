const { generateContent, isAvailable, getModel } = require('./geminiClient');

/**
 * Clean markdown formatting from AI response text
 */
const cleanResponseText = (text) => {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/```[\w]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*+]\s/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Build system prompt from user profile
 */
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

/**
 * Generate a chat response for the AI coach
 */
const chat = async (message, conversationHistory, user) => {
  if (!isAvailable()) {
    return {
      success: false,
      response: "I'm having trouble connecting to the AI service. Please try again later.",
      message: 'AI service not configured',
    };
  }

  const systemPrompt = buildSystemPrompt(user);
  let context = systemPrompt + '\n\n';

  const recent = (conversationHistory || []).slice(-6);
  recent.forEach((msg) => {
    context += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
  });
  context += `User: ${message}\nAssistant:`;

  const rawResponse = await generateContent(context, { maxOutputTokens: 1024 });
  const cleaned = cleanResponseText(rawResponse);

  // Check if recipes are needed
  let recipes = null;
  const lower = message.toLowerCase();
  if (['recipe', 'meal', 'food', 'cook'].some((kw) => lower.includes(kw))) {
    recipes = await generateRecipes(message, user);
  }

  return {
    success: true,
    response: cleaned,
    recipes,
    timestamp: new Date(),
  };
};

/**
 * Generate recipe suggestions
 */
const generateRecipes = async (query, user) => {
  try {
    const goals = Array.isArray(user.fitnessGoals) ? user.fitnessGoals.join(', ') : 'general fitness';
    const diet = user.dietaryPreference || 'No Restrictions';

    const prompt = `Generate 2 healthy recipes related to: "${query}"

User preferences:
- Dietary: ${diet}
- Goals: ${goals}

Return ONLY a valid JSON array in this format:
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
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["step 1", "step 2"],
    "tags": ["healthy", "fitness"]
  }
]`;

    const text = await generateContent(prompt, { maxOutputTokens: 2048 });
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch (err) {
    console.error('Recipe generation error:', err.message);
    return null;
  }
};

/**
 * Get personalized suggested questions
 */
const getSuggestions = (user) => {
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
  if (goals.includes('weight-loss')) {
    suggestions.unshift('What are effective weight loss strategies?');
    suggestions.unshift('Can you suggest low-calorie recipes?');
  }
  if (goals.includes('muscle-gain')) {
    suggestions.unshift('How much protein should I eat for muscle gain?');
    suggestions.unshift("What's a good strength training routine?");
  }
  if (user.dietaryPreference && user.dietaryPreference !== 'No Restrictions') {
    suggestions.unshift(`Can you suggest ${user.dietaryPreference} recipes?`);
  }

  return suggestions.slice(0, 8);
};

module.exports = { chat, getSuggestions };
