import { useEffect, useState } from 'react';
import { getUserStats } from '../services';
import { getWorkoutStatistics } from '../../workouts/services';

const defaultStats = {
  totalWorkouts: 0,
  totalCaloriesBurned: 0,
  averageWorkoutTimeMinutes: 0,
  totalWorkoutTimeMinutes: 0,
  recentWorkouts: [],
};

const useProfileStats = () => {
  const [fitnessStats, setFitnessStats] = useState(defaultStats);

  useEffect(() => {
    async function fetchStats() {
      try {
        const workoutRes = await getWorkoutStatistics();
        if (workoutRes?.statistics) {
          setFitnessStats(workoutRes.statistics);
          return;
        }
      } catch {
        // Fall through to the profile stats endpoint.
      }

      try {
        const res = await getUserStats();
        const stats = res?.data?.stats || {};
        setFitnessStats({
          totalWorkouts: stats.totalWorkouts ?? 0,
          totalCaloriesBurned: stats.caloriesBurned ?? 0,
          averageWorkoutTimeMinutes: stats.avgWorkout ?? 0,
          totalWorkoutTimeMinutes: 0,
          recentWorkouts: [],
        });
      } catch {
        setFitnessStats(defaultStats);
      }
    }

    fetchStats();
  }, []);

  return {
    fitnessStats,
  };
};

export default useProfileStats;
