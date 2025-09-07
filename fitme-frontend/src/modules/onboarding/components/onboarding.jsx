import React, { useState } from "react";
import Location from "../../../components/onboarding/location";
import Goal from "../../../components/onboarding/goal";
import Gender from "../../../components/onboarding/gender";
import Birthday from "../../../components/onboarding/birthday";
import Height from "../../../components/onboarding/height";
import Weight from "../../../components/onboarding/weight";
import FitnessExperience from "../../../components/onboarding/fitness-experience";
import PreferredWorkouts from "../../../components/onboarding/preferred-workouts";
import WorkoutFrequency from "../../../components/onboarding/workout-frequency";
import DietaryPreferences from "../../../components/onboarding/dietary-preferences";
import Summary from "../../../components/onboarding/summary";

const Onboarding = () => {
  const [step, setStep] = useState(1);
  const [userData, setUserData] = useState({
    // Basic info
    goal: "",
    gender: "",
    birthday: "",
    height: "",
    currentWeight: "",
    goalWeight: "",
    location: "",
    
    // Extended questionnaire
    fitnessExperience: "",
    preferredWorkouts: [],
    workoutFrequency: "",
    workoutDuration: "",
    dietaryPreference: "",
    
    // Dynamic goal-specific fields
    targetMuscleGain: "",
    currentStrengthLevel: ""
  });

  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  const handleChange = (input) => (e) => {
    let value = e.target.value;
    if (input === 'birthday') {
      // Convert DD/MM/YYYY to YYYY-MM-DD
      const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (match) {
        const [, day, month, year] = match;
        const paddedDay = day.padStart(2, '0');
        const paddedMonth = month.padStart(2, '0');
        value = `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    setUserData({ ...userData, [input]: value });
  };

  // Special handler for array fields
  const handleArrayChange = (input) => (value) => {
    setUserData({ ...userData, [input]: value });
  };

  // Update data for complex components
  const updateData = (data) => {
    setUserData({ ...userData, ...data });
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return <Goal nextStep={nextStep} handleChange={handleChange} values={userData} />;
      case 2:
        return <Gender nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 3:
        return <Birthday nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 4:
        return <Height nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 5:
        return <Weight nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 6:
        return <FitnessExperience nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 7:
        return <PreferredWorkouts nextStep={nextStep} prevStep={prevStep} handleChange={handleArrayChange} values={{...userData, updateData}} />;
      case 8:
        return <WorkoutFrequency nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 9:
        return <DietaryPreferences nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={{...userData, updateData}} />;
      case 10:
        return <Location nextStep={nextStep} prevStep={prevStep} handleChange={handleChange} values={userData} />;
      case 11:
        return <Summary prevStep={prevStep} values={userData} />;
      default:
        return <div>Step not found</div>;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="w-full max-w-md mx-auto">
        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>Step {step} of 10</span>
            <span>{Math.round((step / 10) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-black h-2 rounded-full transition-all duration-300"
              style={{ width: `${(step / 10) * 100}%` }}
            ></div>
          </div>
        </div>
        
        {renderStep()}
      </div>
    </div>
  );
};

export default Onboarding; 
