import React, { useState, useEffect } from "react";
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import userStorage from "../../utils/user-scoped-storage";
import {
  DAILY_TASKS_KEY,
  NUTRITION_LOG_KEY,
  parseNutritionLog,
  recordCompletedMeal,
  restoreDailyTasks,
  serializeDailyTasks,
  isCurrentDailyTasks,
} from "../../modules/nutrition/utils/nutrition-log";

const readSavedTasks = () => {
  try {
    return JSON.parse(userStorage.getItem(DAILY_TASKS_KEY) || "{}");
  } catch {
    return {};
  }
};

const DailyRoutine = () => {
  // Load today's tasks (local calendar day) from storage
  const [tasks, setTasks] = useState(() =>
    restoreDailyTasks(readSavedTasks()).map((task) => ({
      ...task,
      addedTime: new Date(task.addedTime),
    }))
  );

  const [showModal, setShowModal] = useState(false);
  const [selectedTime, setSelectedTime] = useState("");
  const [newTask, setNewTask] = useState({
    category: "",
    name: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: ""
  });

  const colors = ["bg-green-100", "bg-yellow-100", "bg-orange-100", "bg-blue-100", "bg-pink-100"];

  // Default time slots
  const defaultTimeSlots = [
    "7:00 AM",
    "8:00 AM",
    "9:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "2:00 PM",
    "4:00 PM",
    "6:00 PM",
    "7:00 PM",
    "8:00 PM",
    "9:00 PM",
    "10:00 PM",
  ];

  // Helper to parse time string (e.g., '8:00 PM') to minutes since midnight
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (modifier === 'PM' && hours !== 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  // Collect all unique times from tasks, but limit to prevent overflow
  const taskTimes = tasks.map(task => task.time).filter(Boolean);
  const allTimesSet = new Set([...defaultTimeSlots.slice(0, 8), ...taskTimes]); // Limit to 8 default slots
  const allTimesSorted = Array.from(allTimesSet).sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));

  // When tasks change, save with today's date
  useEffect(() => {
    userStorage.setItem(DAILY_TASKS_KEY, JSON.stringify(serializeDailyTasks(tasks)));
    // Dispatch custom event to notify other components (like Profile stats)
    window.dispatchEvent(new Event('dailyTasksUpdated'));
  }, [tasks]);

  // When checking for temporary tasks, also check if date changed (in case app left open overnight)
  useEffect(() => {
    const checkTemporaryTasks = () => {
      const now = new Date();
      // If the local date changed (app left open overnight) or the record is in the old
      // UTC-day format, keep only what belongs to today.
      const saved = readSavedTasks();
      if (!isCurrentDailyTasks(saved, now)) {
        const restored = restoreDailyTasks(saved, now);
        setTasks(restored);
        userStorage.setItem(DAILY_TASKS_KEY, JSON.stringify(serializeDailyTasks(restored, now)));
        return;
      }
      // Read current tasks from storage to avoid stale closure
      try {
        const currentTasks = readSavedTasks();
        const taskList = currentTasks.tasks || [];
        const updatedTasks = taskList.filter((task) => {
          const timeDiff = (now - new Date(task.addedTime)) / (1000 * 60 * 60);
          return timeDiff < 12;
        });
        // Only update if tasks actually changed
        if (updatedTasks.length !== taskList.length) {
          userStorage.setItem(DAILY_TASKS_KEY, JSON.stringify(serializeDailyTasks(updatedTasks, now)));
          setTasks(updatedTasks);
        }
      } catch {
        // If read fails, do nothing
      }
    };

    const interval = setInterval(checkTemporaryTasks, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Add a completed meal to today's (local calendar day) nutrition log
  const trackCumulativeNutrition = (task, isCompleting) => {
    if (!isCompleting) return; // Only track when completing, not uncompleting
    try {
      const log = parseNutritionLog(userStorage.getItem(NUTRITION_LOG_KEY));
      const result = recordCompletedMeal(log, task);
      if (!result.added) return; // Already counted
      task.countedOn = result.dayKey;
      userStorage.setItem(NUTRITION_LOG_KEY, JSON.stringify(result.log));
      // Dispatch event to notify Profile component
      window.dispatchEvent(new Event('nutritionDataUpdated'));
    } catch (error) {
      console.error('Error tracking cumulative nutrition:', error);
    }
  };

  const deleteTask = (taskIndex) => {
    const updatedTasks = tasks.filter((_, index) => index !== taskIndex);
    setTasks(updatedTasks);
  };

  const toggleTaskCompletion = (index) => {
    const updatedTasks = [...tasks];
    const task = updatedTasks[index];
    const wasCompleted = task.completed;
    const isBeingCompleted = !wasCompleted;
    
    task.completed = !task.completed;
    
    // Track cumulative nutrition only when completing (not uncompleting)
    if (isBeingCompleted && task.calories) {
      trackCumulativeNutrition(task, true);
    }
    
    setTasks(updatedTasks);
  };

  const openModal = (time) => {
    setSelectedTime(time);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setNewTask({ category: "", name: "", calories: "", protein: "", carbs: "", fat: "" });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewTask({ ...newTask, [name]: value });
  };

  const addTask = () => {
    if (newTask.category && newTask.name && newTask.calories) {
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const taskToAdd = {
        time: selectedTime,
        category: newTask.category,
        name: newTask.name,
        calories: parseFloat(newTask.calories),
        protein: parseFloat(newTask.protein) || 0,
        carbs: parseFloat(newTask.carbs) || 0,
        fat: parseFloat(newTask.fat) || 0,
        completed: false,
        color: randomColor,
        addedTime: new Date(),
      };
      setTasks([...tasks, taskToAdd]);
      closeModal();
    } else {
      alert("Please fill in category, name, and calories!");
    }
  };

  return (
    <div className="bg-green-100 rounded-xl shadow-sm p-4 w-full flex flex-col h-full">
      <div className="flex flex-col flex-1 min-h-0">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Daily Routine</h2>

        {/* Timeline */}
        <div className="space-y-2 flex-1 overflow-hidden">
          {allTimesSorted.map((time, index) => {
            const taskAtTime = tasks.find((task) => task.time === time);

            return (
              <div key={index} className="flex items-center py-1">
                {/* Time Label */}
                <div className="w-20 text-sm text-gray-600">{time}</div>

                {/* Task or Add Button */}
                <div className="flex-1">
                  {taskAtTime ? (
                    <div
                      className={`group relative flex items-center justify-between p-3 rounded-lg shadow-sm ${taskAtTime.color} transition-all`}
                    >
                      <div className={`flex items-center space-x-2 ${taskAtTime.completed ? "opacity-50" : ""}`}>
                        <input
                          type="checkbox"
                          checked={taskAtTime.completed}
                          onChange={() => toggleTaskCompletion(tasks.indexOf(taskAtTime))}
                          className="h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{taskAtTime.category}</p>
                          <p className="text-sm text-gray-600">{taskAtTime.name}</p>
                          {(taskAtTime.protein > 0 || taskAtTime.carbs > 0 || taskAtTime.fat > 0) && (
                            <div className="flex gap-1 mt-1">
                              {taskAtTime.protein > 0 && (
                                <span className="text-xs bg-red-100 text-red-600 px-1 rounded">P:{taskAtTime.protein}g</span>
                              )}
                              {taskAtTime.carbs > 0 && (
                                <span className="text-xs bg-yellow-100 text-yellow-600 px-1 rounded">C:{taskAtTime.carbs}g</span>
                              )}
                              {taskAtTime.fat > 0 && (
                                <span className="text-xs bg-purple-100 text-purple-600 px-1 rounded">F:{taskAtTime.fat}g</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <p className={`text-sm text-gray-600 ${taskAtTime.completed ? "opacity-50" : ""}`}>{taskAtTime.calories} kcal</p>
                        {/* Delete button - only visible on hover */}
                        <button
                          onClick={() => deleteTask(tasks.indexOf(taskAtTime))}
                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                          title="Delete task"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex-1 h-px bg-gray-200"></div>
                      <button
                        className="ml-2 text-green-600 hover:text-green-800 focus:outline-none transition-colors duration-200 hover:bg-green-50 rounded-full p-1"
                        onClick={() => openModal(time)}
                        title="Add meal or activity"
                      >
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M12 4v16m8-8H4"
                          ></path>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Footer message when no tasks are added */}
        {tasks.length === 0 && (
          <div className="mt-4 pt-3 border-t border-green-200">
            <p className="text-center text-xs text-gray-500 italic">
              Click the + buttons to add meals and activities
            </p>
          </div>
        )}
      </div>

      {/* Modal (Portal to avoid clipping) */}
      {showModal && createPortal(
        (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={closeModal} />
            <div className="relative bg-white p-6 rounded-lg shadow-lg w-full max-w-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Add New Task at {selectedTime}</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  name="category"
                  value={newTask.category}
                  onChange={handleInputChange}
                  placeholder="Category (e.g., Breakfast)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  name="name"
                  value={newTask.name}
                  onChange={handleInputChange}
                  placeholder="Task Name (e.g., Oatmeal)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  name="calories"
                  value={newTask.calories}
                  onChange={handleInputChange}
                  placeholder="Calories (e.g., 280)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  name="protein"
                  value={newTask.protein}
                  onChange={handleInputChange}
                  placeholder="Protein in grams (optional)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  name="carbs"
                  value={newTask.carbs}
                  onChange={handleInputChange}
                  placeholder="Carbs in grams (optional)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="number"
                  name="fat"
                  value={newTask.fat}
                  onChange={handleInputChange}
                  placeholder="Fat in grams (optional)"
                  className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex space-x-2">
                  <button
                    onClick={addTask}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-all"
                  >
                    Add Task
                  </button>
                  <button
                    onClick={closeModal}
                    className="flex-1 bg-gray-300 text-gray-800 py-2 rounded-lg hover:bg-gray-400 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ),
        document.body
      )}
    </div>
  );
};

export default DailyRoutine;
