import { useEffect, useState } from 'react';
import { getWorkoutStatistics, getWeeklySummary } from '../services';

// Totals come from /workouts/statistics only (the same source Profile and Analytics use).
const useDashboardData = () => {
  const [workoutStats, setWorkoutStats] = useState({});
  const [weeklySummary, setWeeklySummary] = useState(null);

  useEffect(() => {
    getWorkoutStatistics().then((res) => setWorkoutStats(res?.statistics || {})).catch(() => setWorkoutStats({}));
    getWeeklySummary().then((res) => setWeeklySummary(res)).catch(() => setWeeklySummary(null));
  }, []);

  return {
    workoutStats,
    weeklySummary,
  };
};

export default useDashboardData;
