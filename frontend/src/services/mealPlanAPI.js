/**
 * Meal Plan API — uses Express backend only (no FastAPI)
 */
import api from './api.js';
import mealPlanPersistence from './mealPlanPersistence';

// Meal Plan API
export const mealPlanAPI = {
  // Generate a new meal plan
  generateMealPlan: async (userProfile, preferences = {}) => {
    try {
      const response = await api.post('/mealplan/generate', {
        user_profile: userProfile,
        budget_range: preferences.budget || 'medium',
        cooking_skill: preferences.cooking_skill || 'intermediate',
        meal_focus: preferences.meal_focus || 'balanced',
        max_prep_time: preferences.max_prep_time || 30,
        regenerate: preferences.regenerate || false,
      });
      if (response.data?.data?.meals) {
        mealPlanPersistence.setCurrentPlanMeals(response.data.data.meals);
      }
      return response.data;
    } catch (error) {
      console.error('Error generating meal plan:', error);
      throw error;
    }
  },

  // Get all meal plans for the user
  getMealPlans: async (limit = 10, skip = 0) => {
    const response = await api.get('/mealplan/', { params: { limit, skip } });
    return response.data;
  },

  // Get a specific meal plan
  getMealPlan: async (planId) => {
    const response = await api.get(`/mealplan/${planId}`);
    return response.data;
  },

  // Delete a meal plan
  deleteMealPlan: async (planId) => {
    const response = await api.delete(`/mealplan/${planId}`);
    return response.data;
  },

  // Regenerate an existing meal plan
  regenerateMealPlan: async (planId) => {
    const response = await api.post(`/mealplan/regenerate/${planId}`);
    return response.data;
  },

  // Generate daily meal plan
  generateDailyMealPlan: async (dailyRequest) => {
    try {
      const response = await api.post('/mealplan/generate', {
        age: dailyRequest.age || 30,
        weight: dailyRequest.weight || 70,
        height: dailyRequest.height || 170,
        gender: dailyRequest.gender || 'other',
        activity_level: dailyRequest.activity_level || 'moderately_active',
        fitness_goal: dailyRequest.fitness_goal || 'maintenance',
        dietary_preferences: dailyRequest.dietary_preferences || [],
        allergies: dailyRequest.allergies || [],
        disliked_foods: dailyRequest.disliked_foods || [],
        preferred_cuisines: dailyRequest.preferred_cuisines || [],
        budget_range: dailyRequest.budget || 'medium',
        cooking_skill: dailyRequest.cooking_skill || 'intermediate',
        meal_focus: dailyRequest.meal_focus || 'balanced',
        max_prep_time: dailyRequest.max_prep_time || 30,
      });
      if (response.data?.data?.meals) {
        mealPlanPersistence.setCurrentPlanMeals(response.data.data.meals);
      }
      return response.data;
    } catch (error) {
      console.error('Error generating daily meal plan:', error);
      throw error;
    }
  },

  // Analyze nutrition for food items
  analyzeNutrition: async (foodItems, portions = []) => {
    const response = await api.post('/mealplan/nutrition/analyze', {
      food_items: foodItems,
      portions,
    });
    return response.data;
  },
};

// Utility functions for meal plan data transformation
export const mealPlanUtils = {
  // Transform daily meal plan to frontend format
  transformDailyPlanToFrontendFormat: (mealPlan) => {
    if (!mealPlan || !mealPlan.meals) {
      console.error('Invalid meal plan data:', mealPlan);
      return {};
    }

    const meals = mealPlan.meals;
    const transformed = {};

    for (const mealType of ['breakfast', 'lunch', 'dinner', 'snack']) {
      if (meals[mealType]) {
        transformed[mealType] = {
          name: meals[mealType].name,
          ingredients: meals[mealType].ingredients || [],
          recipe: meals[mealType].instructions || [],
          prepTime: meals[mealType].prep_time || 0,
          nutrition: meals[mealType].nutrition || null,
          description: meals[mealType].description || '',
          cuisineType: meals[mealType].cuisine_type || '',
          difficulty: meals[mealType].difficulty || 'medium',
          portionSize: meals[mealType].portion_size || 'serves 1',
        };
      }
    }

    transformed.dailyTotals = {
      calories: meals.total_calories || 0,
      protein: meals.total_protein || 0,
      carbs: meals.total_carbs || 0,
      fat: meals.total_fat || 0,
    };

    return transformed;
  },

  // Transform weekly plan (kept for compatibility)
  transformToFrontendFormat: (mealPlan) => {
    return { plans: mealPlanUtils.transformDailyPlanToFrontendFormat(mealPlan) };
  },

  // Get user profile from stored data
  getUserProfileFromStorage: () => {
    const user = JSON.parse(localStorage.getItem('fitme_user') || '{}');
    return {
      age: user.age || 30,
      weight: user.weight || 70,
      height: user.height || 170,
      gender: user.gender || 'other',
      activity_level: user.activityLevel || 'moderately_active',
      fitness_goal: user.fitnessGoal || 'maintenance',
      dietary_preferences: user.dietaryPreferences || [],
      allergies: user.allergies || [],
      disliked_foods: user.dislikedFoods || [],
      preferred_cuisines: user.preferredCuisines || [],
      budget_range: user.budgetRange || 'medium',
      cooking_skill: user.cookingSkill || 'intermediate',
    };
  },

  // Create daily request from user preferences
  createDailyRequest: (preferences = {}) => {
    const userProfile = mealPlanUtils.getUserProfileFromStorage();
    return {
      target_day: preferences.target_day || 'Today',
      ...userProfile,
      ...preferences,
    };
  },
};

export default mealPlanAPI;
