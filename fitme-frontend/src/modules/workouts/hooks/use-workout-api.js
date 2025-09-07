import { useCallback, useMemo } from 'react';
import {
  generateWorkoutPlan,
  saveWorkoutPlan,
  getSavedWorkoutPlans,
  getWorkoutPlanById,
  deleteWorkoutPlan,
  createCustomWorkout,
  completeWorkout,
} from '../services';

const useWorkoutApi = () => {
  const requestGenerateWorkoutPlan = useCallback((profile) => generateWorkoutPlan(profile), []);
  const requestSaveWorkoutPlan = useCallback((workoutPlan, name) => saveWorkoutPlan(workoutPlan, name), []);
  const requestSavedWorkoutPlans = useCallback((options) => getSavedWorkoutPlans(options), []);
  const requestWorkoutPlanById = useCallback((planId) => getWorkoutPlanById(planId), []);
  const requestDeleteWorkoutPlan = useCallback((planId) => deleteWorkoutPlan(planId), []);
  const requestCreateCustomWorkout = useCallback((name, exercises) => createCustomWorkout(name, exercises), []);
  const requestCompleteWorkout = useCallback((workoutData) => completeWorkout(workoutData), []);

  return useMemo(() => ({
    generateWorkoutPlan: requestGenerateWorkoutPlan,
    saveWorkoutPlan: requestSaveWorkoutPlan,
    getSavedWorkoutPlans: requestSavedWorkoutPlans,
    getWorkoutPlanById: requestWorkoutPlanById,
    deleteWorkoutPlan: requestDeleteWorkoutPlan,
    createCustomWorkout: requestCreateCustomWorkout,
    completeWorkout: requestCompleteWorkout,
  }), [
    requestGenerateWorkoutPlan,
    requestSaveWorkoutPlan,
    requestSavedWorkoutPlans,
    requestWorkoutPlanById,
    requestDeleteWorkoutPlan,
    requestCreateCustomWorkout,
    requestCompleteWorkout,
  ]);
};

export default useWorkoutApi;
