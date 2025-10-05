import React, { useEffect, useState, useCallback } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Activity, 
  Zap, 
  Award,
  Clock,
  Flame
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LabelList } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../../context/auth-context';
import userStorage from '../../../utils/user-scoped-storage';
import useAnalyticsData from '../hooks/use-analytics-data';
import { formatDuration, secondsFrom } from '../../../utils/duration-utils';
import { buildPeriodBuckets, bucketWorkoutHistory } from '../utils/period-buckets';
import { NUTRITION_LOG_KEY, parseNutritionLog, bucketNutritionLog } from '../../nutrition/utils/nutrition-log';

const Progress = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('week');
  const [selectedMetric, setSelectedMetric] = useState('calories');
  const [selectedIntakeMetric, setSelectedIntakeMetric] = useState('calories'); // calories | protein | carbs | fat
  const { user } = useAuth();
  const { workoutStats } = useAnalyticsData();
  const [periodData, setPeriodData] = useState({ calories: [], workouts: [], eatenCalories: [], eatenProtein: [], eatenCarbs: [], eatenFat: [] });

  // Build dynamic data for different time periods.
  // Workout series come from the backend history in the same statistics response as the cards.
  const buildPeriodData = useCallback((period) => {
    const buckets = buildPeriodBuckets(period);
    if (!buckets.length) {
      return { calories: [], workouts: [], eatenCalories: [], eatenProtein: [], eatenCarbs: [], eatenFat: [] };
    }
    const workoutTotals = bucketWorkoutHistory(buckets, workoutStats?.history);
    const caloriesArray = buckets.map((b, i) => ({ day: b.label, value: workoutTotals[i].calories }));
    const workoutsArray = buckets.map((b, i) => ({ day: b.label, value: workoutTotals[i].workouts }));

    // Nutrition (from storage), keyed by local calendar day and bucketed over the same
    // [start, end) local ranges as the workout series above.
    const nutrition = parseNutritionLog(userStorage.getItem(NUTRITION_LOG_KEY));
    const nutritionTotals = bucketNutritionLog(buckets, nutrition, period);
    const nutritionSeries = (macro) => buckets.map((b, i) => ({ day: b.label, value: nutritionTotals[i][macro] }));
    const eatenCaloriesArray = nutritionSeries('calories');
    const eatenProteinArray = nutritionSeries('protein');
    const eatenCarbsArray = nutritionSeries('carbs');
    const eatenFatArray = nutritionSeries('fat');

    return {
      calories: caloriesArray,
      workouts: workoutsArray,
      eatenCalories: eatenCaloriesArray,
      eatenProtein: eatenProteinArray,
      eatenCarbs: eatenCarbsArray,
      eatenFat: eatenFatArray,
    };
  }, [workoutStats]);

  // Build data for selected period
  const rebuildPeriodData = useCallback(() => {
    const data = buildPeriodData(selectedPeriod);
    setPeriodData(data);
  }, [buildPeriodData, selectedPeriod]);

  useEffect(() => {
    rebuildPeriodData();
  }, [rebuildPeriodData]);

  // Refresh when workout-related events fire
  useEffect(() => {
    const handler = () => {
      rebuildPeriodData();
    };
    window.addEventListener('dailyTasksUpdated', handler);
    window.addEventListener('workoutStatsUpdated', handler);
    return () => {
      window.removeEventListener('dailyTasksUpdated', handler);
      window.removeEventListener('workoutStatsUpdated', handler);
    };
  }, [rebuildPeriodData]);

  const monthlyProgress = {
    currentWeight: user?.weight ?? 0,
    targetWeight: user?.goalWeight ?? 0,
    startWeight: user?.weight ?? 0,
    caloriesBurned: workoutStats?.totalCaloriesBurned ?? 0,
    workoutsCompleted: workoutStats?.totalWorkouts ?? 0,
    averageWorkoutSeconds: secondsFrom(workoutStats?.averageWorkoutTimeSeconds, workoutStats?.averageWorkoutTimeMinutes),
    longestStreak: user?.longestStreak ?? 0
  };

  // Animation variants
  const pageVariant = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.5 } }
  };

  const sectionVariant = {
    hidden: { opacity: 0, y: 20 },
    visible: (custom) => ({
      opacity: 1,
      y: 0,
      transition: { delay: custom * 0.1, duration: 0.5 }
    })
  };

  const cardContainerVariant = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const cardVariant = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
  };

  const hoverCard = {
    hover: { y: -5, transition: { duration: 0.2 } }
  };

  const ProgressBar = ({ value, max, color }) => (
    <motion.div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <motion.div
        className={color + " h-2 rounded-full"}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }}
        transition={{ duration: 1.2, type: 'spring', stiffness: 60 }}
      />
    </motion.div>
  );

  const intakeColor = (metric) => {
    switch (metric) {
      case 'protein': return '#ef4444';
      case 'carbs': return '#f59e0b';
      case 'fat': return '#a855f7';
      default: return '#10b981'; // calories
    }
  };

  const intakeYAxisLabel = selectedIntakeMetric === 'calories' ? 'Calories (kcal)' : `${selectedIntakeMetric.charAt(0).toUpperCase() + selectedIntakeMetric.slice(1)} (g)`;
  const intakeDataKey = selectedIntakeMetric === 'calories' ? 'eatenCalories' : selectedIntakeMetric === 'protein' ? 'eatenProtein' : selectedIntakeMetric === 'carbs' ? 'eatenCarbs' : 'eatenFat';
  const intakeTitle = selectedIntakeMetric === 'calories' ? 'Eaten Calories Progress' : `Eaten ${selectedIntakeMetric.charAt(0).toUpperCase() + selectedIntakeMetric.slice(1)} Progress`;
  const intakeSubtitle = selectedPeriod === 'month'
    ? (selectedIntakeMetric === 'calories' ? 'Track your weekly calorie intake' : `Track your weekly ${selectedIntakeMetric} intake`)
    : (selectedIntakeMetric === 'calories' ? 'Track your daily calorie intake over time' : `Track your daily ${selectedIntakeMetric} intake over time`);

  return (
    <motion.div
      variants={pageVariant}
      initial="hidden"
      animate="visible"
      className="min-h-screen p-4 sm:p-6"
      style={{ backgroundColor: '#FAF7F2' }}
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          custom={0}
          className="bg-white rounded-2xl shadow-sm p-6"
        >
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
              <p className="text-gray-600 mt-2">Monitor your fitness journey and celebrate your achievements.</p>
            </div>
            <div className="flex gap-3">
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              >
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="year">This Year</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* Key Metrics Cards */}
        <motion.div
          variants={cardContainerVariant}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {[
            {
              icon: <Target className="w-6 h-6 text-blue-600" />,
              bg: 'bg-blue-100',
              cardBg: 'bg-blue-50',
              value: `${monthlyProgress.currentWeight} kg`,
              label: 'Current Weight',
              note: (monthlyProgress.targetWeight && monthlyProgress.currentWeight)
                ? `${Math.sign(monthlyProgress.targetWeight - monthlyProgress.currentWeight) >= 0 ? '' : '+'}${(monthlyProgress.currentWeight - monthlyProgress.targetWeight).toFixed(1)} kg from goal`
                : '—'
            },
            {
              icon: <Flame className="w-6 h-6 text-orange-600" />,
              bg: 'bg-orange-100',
              cardBg: 'bg-orange-50',
              value: monthlyProgress.caloriesBurned,
              label: 'Calories Burned',
              note: '—'
            },
            {
              icon: <Activity className="w-6 h-6 text-green-600" />,
              bg: 'bg-green-100',
              cardBg: 'bg-green-50',
              value: monthlyProgress.workoutsCompleted,
              label: 'Workouts Completed',
              note: '—'
            },
            {
              icon: <Clock className="w-6 h-6 text-purple-600" />,
              bg: 'bg-purple-100',
              cardBg: 'bg-purple-50',
              value: formatDuration(monthlyProgress.averageWorkoutSeconds),
              label: 'Avg Workout Time',
              note: '—'
            }
          ].map((card, i) => (
            <motion.div
              key={i}
              whileHover="hover"
              animate="visible"
              initial="hidden"
              variants={{ ...cardVariant, ...hoverCard }}
              className={`rounded-xl shadow-sm p-4 cursor-pointer transition-all border border-gray-100 ${card.cardBg}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 ${card.bg} rounded-lg`}>{card.icon}</div>
                {card.note && <span className="text-xs text-gray-500">{card.note}</span>}
              </div>
              <p className="text-xl font-bold text-gray-900 leading-tight">{card.value}</p>
              <p className="text-xs text-gray-600">{card.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Charts Section */}
        <motion.div 
          variants={sectionVariant}
          initial="hidden"
          animate="visible"
          custom={1}
          className="grid grid-cols-1 gap-6"
        >
          {/* Weight Progress Chart */}
          <motion.div
            variants={sectionVariant}
            initial="hidden"
            animate="visible"
            custom={2}
            className="bg-white rounded-2xl shadow-sm p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {selectedMetric === 'calories' && 'Calories Burned Progress'}
                  {selectedMetric === 'workouts' && 'Workouts Progress'}
                </h3>
                <p className="text-sm text-gray-600">
                  {`${selectedMetric === 'calories' ? 'Calories burned' : 'Workouts completed'} per ${{ week: 'day', month: 'week', quarter: 'quarter', year: 'month' }[selectedPeriod]}`}
                </p>
              </div>
              <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              >
                <option value="calories">Calories Burned</option>
                <option value="workouts">Workouts</option>
              </select>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={periodData[selectedMetric]} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  stroke="#8884d8"
                  tickMargin={12}
                  label={{ 
                    value: selectedPeriod === 'quarter' ? 'Quarter' : selectedPeriod === 'year' ? 'Month' : selectedPeriod === 'month' ? 'Week' : 'Day', 
                    position: 'insideBottom', 
                    offset: -40, 
                    fill: '#64748b' 
                  }}
                />
                <YAxis
                  stroke="#8884d8"
                  allowDecimals={selectedMetric !== 'workouts'}
                  width={90}
                  label={{
                    value: selectedMetric === 'calories' ? 'Calories (kcal)' : 'Workouts (count)',
                    angle: -90,
                    position: 'insideLeft',
                    style: { textAnchor: 'middle' },
                    fill: '#64748b'
                  }}
                />
                <Tooltip 
                  labelFormatter={(label) => {
                    if (selectedPeriod === 'quarter') {
                      const map = { Q1: 'Jan-Mar', Q2: 'Apr-Jun', Q3: 'Jul-Sep', Q4: 'Oct-Dec' };
                      const range = map[label] || null;
                      return range ? `${label} (${range})` : label;
                    }
                    if (selectedPeriod === 'month' && label.includes('-')) {
                      // Show full week range in tooltip
                      return `Week: ${label}`;
                    }
                    return label;
                  }}
                  formatter={(value, name) => {
                  if (selectedMetric === 'calories') return [`${value} kcal`, 'Calories Burned'];
                  if (selectedMetric === 'workouts') return [value, 'Workouts'];
                  return [value, name];
                }} />
                <Line type="monotone" dataKey="value" name={selectedMetric}
                  stroke={selectedMetric === 'calories' ? '#f97316' : '#22c55e'}
                  strokeWidth={3}
                  dot={{ r: 5, fill: selectedMetric === 'calories' ? '#f97316' : '#22c55e', stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                  animationDuration={1200}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Eaten Intake Chart (Calories / Protein / Carbs / Fat) */}
          <motion.div
            variants={sectionVariant}
            initial="hidden"
            animate="visible"
            custom={3}
            className="bg-white rounded-2xl shadow-sm p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{intakeTitle}</h3>
                <p className="text-sm text-gray-600">{intakeSubtitle}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedIntakeMetric}
                  onChange={(e) => setSelectedIntakeMetric(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                >
                  <option value="calories">Calories</option>
                  <option value="protein">Protein</option>
                  <option value="carbs">Carbs</option>
                  <option value="fat">Fat</option>
                </select>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={periodData[intakeDataKey]} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  stroke="#8884d8"
                  tickMargin={12}
                  label={{ 
                    value: selectedPeriod === 'quarter' ? 'Quarter' : selectedPeriod === 'year' ? 'Month' : selectedPeriod === 'month' ? 'Week' : 'Day', 
                    position: 'insideBottom', 
                    offset: -40, 
                    fill: '#64748b' 
                  }}
                />
                <YAxis
                  stroke="#8884d8"
                  allowDecimals={true}
                  width={90}
                  label={{
                    value: intakeYAxisLabel,
                    angle: -90,
                    position: 'insideLeft',
                    style: { textAnchor: 'middle' },
                    fill: '#64748b'
                  }}
                />
                <Tooltip 
                  labelFormatter={(label) => {
                    if (selectedPeriod === 'quarter') {
                      const map = { Q1: 'Jan-Mar', Q2: 'Apr-Jun', Q3: 'Jul-Sep', Q4: 'Oct-Dec' };
                      const range = map[label] || null;
                      return range ? `${label} (${range})` : label;
                    }
                    if (selectedPeriod === 'month' && label.includes('-')) {
                      // Show full week range in tooltip
                      return `Week: ${label}`;
                    }
                    return label;
                  }}
                  formatter={(value) => [
                    selectedIntakeMetric === 'calories' ? `${value} kcal` : `${value} g`,
                    selectedIntakeMetric.charAt(0).toUpperCase() + selectedIntakeMetric.slice(1)
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  name={selectedIntakeMetric}
                  stroke={intakeColor(selectedIntakeMetric)}
                  strokeWidth={3}
                  dot={{ r: 5, fill: intakeColor(selectedIntakeMetric), stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                  animationDuration={1200}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        </motion.div>


      </div>
    </motion.div>
  );
};

export default Progress;
