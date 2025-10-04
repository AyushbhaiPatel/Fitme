import React, { useMemo } from 'react';
import userStorage from '../../utils/user-scoped-storage';
import { NUTRITION_LOG_KEY, parseNutritionLog, dayTotals } from '../../modules/nutrition/utils/nutrition-log';
import { toLocalDateKey } from '../../utils/local-date';
import { buildPeriodBuckets } from '../../modules/analytics/utils/period-buckets';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

const EatenCaloriesChart = () => {
  // Build chart data
  const data = useMemo(() => {
    const nutrition = parseNutritionLog(userStorage.getItem(NUTRITION_LOG_KEY));
    // Monday-Sunday of the current local week, the same days as the analytics charts
    return buildPeriodBuckets('week').map((b) => ({
      day: b.label,
      value: dayTotals(nutrition, toLocalDateKey(b.start)).calories,
    }));
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Eaten Calories (Current Week)</h2>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 25 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="day" 
            stroke="#64748b" 
            label={{ 
              value: 'Day of Week', 
              position: 'insideBottom', 
              offset: -5, 
              fill: '#64748b' 
            }}
          />
          <YAxis stroke="#64748b" label={{ value: 'kcal', angle: -90, position: 'insideLeft', textAnchor: 'middle', fill: '#64748b' }} />
          <Tooltip formatter={(value) => [`${value} kcal`, 'Eaten']} />
          <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={3} dot={{ r: 5, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 7 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default EatenCaloriesChart;


