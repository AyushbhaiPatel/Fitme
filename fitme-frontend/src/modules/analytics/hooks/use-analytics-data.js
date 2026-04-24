import { useEffect, useState } from 'react';
import { getWorkoutStatistics } from '../services';

const useAnalyticsData = () => {
  const [workoutStats, setWorkoutStats] = useState(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const stats = await getWorkoutStatistics();
        if (isMounted) setWorkoutStats(stats.statistics || stats);
      } catch {
        if (isMounted) setWorkoutStats(null);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    workoutStats,
  };
};

export default useAnalyticsData;
