import { useEffect, useState } from 'react';
import {
  getUserStats,
  getWorkoutStatistics,
  getWeeklySummary,
} from '../services';

const useDashboardData = () => {
  const [stats, setStats] = useState({});
  const [workoutStats, setWorkoutStats] = useState({});
  const [weeklySummary, setWeeklySummary] = useState(null);

  useEffect(() => {
    getUserStats().then((res) => setStats(res?.data?.stats || {})).catch(() => setStats({}));
    getWorkoutStatistics().then((res) => setWorkoutStats(res?.statistics || {})).catch(() => setWorkoutStats({}));
    getWeeklySummary().then((res) => setWeeklySummary(res)).catch(() => setWeeklySummary(null));
  }, []);

  return {
    stats,
    workoutStats,
    weeklySummary,
  };
};

export default useDashboardData;
