import CalorieOverview from '../../../components/dashboard/calorie-overview';
import DailyRoutine from '../../../components/dashboard/daily-routine';
import EatenCaloriesChart from '../../../components/dashboard/eaten-calories-chart';
import FoodOverview from '../../../components/dashboard/food-overview';
import WorkoutOverviewCard from '../../../components/dashboard/workout-overview-card';
import WeeklySummaryCard from '../../../components/dashboard/weekly-summary-card';
import useDashboardData from '../hooks/use-dashboard-data';
import { secondsFrom } from '../../../utils/duration-utils';

const Dashboard = () => {
  const { workoutStats, weeklySummary } = useDashboardData();
  // The calorie ring is a daily budget, so it takes today's burned calories (not the lifetime total).
  const caloriesBurnedToday = weeklySummary?.daily?.find((d) => d.date === weeklySummary.today)?.calories ?? 0;

  return (
    <div className="min-h-screen w-full p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="flex flex-col gap-4 lg:flex-row min-h-[calc(100vh-2rem)] w-full">
        <div className="w-full lg:w-[30%] space-y-4">
          <FoodOverview />
          <CalorieOverview caloriesBurned={caloriesBurnedToday} />
        </div>
        <div className="w-full lg:w-[30%] flex">
          <DailyRoutine />
        </div>
        <div className="w-full lg:w-[40%] space-y-4">
          <WorkoutOverviewCard
            totalWorkouts={workoutStats.totalWorkouts ?? 0}
            avgWorkoutSeconds={secondsFrom(workoutStats.averageWorkoutTimeSeconds, workoutStats.averageWorkoutTimeMinutes)}
            totalCaloriesBurned={workoutStats.totalCaloriesBurned ?? 0}
          />
          <WeeklySummaryCard summary={weeklySummary} />
          <EatenCaloriesChart />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
