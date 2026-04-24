import CalorieOverview from '../../../components/dashboard/calorie-overview';
import DailyRoutine from '../../../components/dashboard/daily-routine';
import EatenCaloriesChart from '../../../components/dashboard/eaten-calories-chart';
import FoodOverview from '../../../components/dashboard/food-overview';
import WorkoutOverviewCard from '../../../components/dashboard/workout-overview-card';
import WeeklySummaryCard from '../../../components/dashboard/weekly-summary-card';
import useDashboardData from '../hooks/use-dashboard-data';

const Dashboard = () => {
  const { stats, workoutStats, weeklySummary } = useDashboardData();

  return (
    <div className="min-h-screen w-full p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="flex flex-col gap-4 lg:flex-row min-h-[calc(100vh-2rem)] w-full">
        <div className="w-full lg:w-[30%] space-y-4">
          <FoodOverview />
          <CalorieOverview caloriesBurned={workoutStats.totalCaloriesBurned ?? stats.caloriesBurned ?? 0} />
        </div>
        <div className="w-full lg:w-[30%] flex">
          <DailyRoutine />
        </div>
        <div className="w-full lg:w-[40%] space-y-4">
          <WorkoutOverviewCard
            totalWorkouts={workoutStats.totalWorkouts ?? stats.totalWorkouts ?? 0}
            avgWorkout={workoutStats.averageWorkoutTimeMinutes ?? stats.avgWorkout ?? 0}
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
