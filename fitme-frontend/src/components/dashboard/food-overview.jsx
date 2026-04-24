import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mealPlanPersistence from '../../modules/nutrition/services/meal-plan-persistence';

const canonicalTypes = ['Breakfast', 'Lunch', 'Dinner'];

const FoodOverview = () => {
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    try {
      const restored = mealPlanPersistence.restorePlan();
      if (restored?.success && restored?.data) {
        setPlan(restored.data);
      } else {
        // Fallback to current plan
        const current = mealPlanPersistence.getCurrentPlan?.();
        if (current) setPlan(current);
      }
    } catch {
      setPlan(null);
    }

    // Update plan on event
    const handler = () => {
      try {
        const restored = mealPlanPersistence.restorePlan();
        if (restored?.success && restored?.data) setPlan(restored.data);
      } catch {
        setPlan(null);
      }
    };
    window.addEventListener('mealPlanUpdated', handler);
    return () => window.removeEventListener('mealPlanUpdated', handler);
  }, []);

  const meals = useMemo(() => {
    const entries = [];
    const p = plan || {};
    // Get meals
    canonicalTypes.forEach((t) => {
      const key = t.toLowerCase();
      const base = p[key];
      let name = base?.name || '';
      if (!name) {
        // Check suffixed keys
        const altKey = Object.keys(p).find(k => k.startsWith(key + '_') && p[k]?.name);
        if (altKey) name = p[altKey].name;
      }
      entries.push({ type: t, description: name || 'Not planned yet' });
    });
    return entries;
  }, [plan]);

  const handleNavigate = (mealType) => {
    navigate('/dashboard/nutrition', { state: { meal: mealType } });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      {/* Header */}
      <h2 className="text-lg font-semibold text-black mb-3">Today's Meals</h2>

      {/* Combined subcard */}
      <div className="bg-green-100 rounded-xl divide-y divide-green-200">
        {meals.map((meal) => (
          <div
            key={meal.type}
            onClick={() => handleNavigate(meal.type)}
            className="flex justify-between items-start px-3 py-3 cursor-pointer hover:bg-green-100 transition-colors first:rounded-t-xl last:rounded-b-xl"
          >
            <div>
              <h3 className="text-md font-semibold text-black">{meal.type}</h3>
              <p className="text-sm text-gray-700">{meal.description}</p>
            </div>
            <ArrowRight className="text-green-600 mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default FoodOverview;
