import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/auth-context';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, User, ArrowLeft } from 'lucide-react';

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
    else if (formData.firstName.trim().length < 2) newErrors.firstName = 'First name must be at least 2 characters';
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
    else if (formData.lastName.trim().length < 2) newErrors.lastName = 'Last name must be at least 2 characters';
    if (!formData.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Please enter a valid email';
    if (!formData.password) newErrors.password = 'Password is required';
    else if (formData.password.length < 8) newErrors.password = 'Password must be at least 8 characters long';
    else if (!/[a-z]/.test(formData.password)) newErrors.password = 'Password must include at least one lowercase letter';
    else if (!/[A-Z]/.test(formData.password)) newErrors.password = 'Password must include at least one uppercase letter';
    else if (!/[0-9]/.test(formData.password)) newErrors.password = 'Password must include at least one number';
    else if (!/[^A-Za-z0-9]/.test(formData.password)) newErrors.password = 'Password must include at least one special character';
    if (!formData.confirmPassword) newErrors.confirmPassword = 'Please confirm your password';
    else if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const result = await register(formData.email, formData.password, formData.confirmPassword, formData.firstName, formData.lastName);
      if (result.success) {
        if (result.requiresEmailVerification) {
          navigate('/otp-verification', { state: { email: formData.email, message: 'Please check your email for the verification code' } });
        } else if (result.onboarding) {
          navigate('/onboarding');
        } else {
          setErrors({ submit: 'Registration completed but something went wrong' });
        }
      } else {
        setErrors({ submit: result.message || 'Registration failed' });
      }
    } catch {
      setErrors({ submit: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (field) =>
    `w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-black focus:border-transparent transition-colors ${errors[field] ? 'border-red-300 bg-red-50' : 'border-gray-300'}`;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="w-full max-w-md">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <Link to="/" className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />Back to Home
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
        >
          <div className="text-center mb-8">
            <div className="text-3xl font-bold text-gray-900 mb-2">FitMe+</div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">Create Account</h1>
            <p className="text-gray-600">Join us and start your fitness journey today</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {[
              { id: 'firstName', label: 'First Name', placeholder: 'Enter your first name' },
              { id: 'lastName', label: 'Last Name', placeholder: 'Enter your last name' },
            ].map(({ id, label, placeholder }) => (
              <div key={id}>
                <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><User className="h-5 w-5 text-gray-400" /></div>
                  <input type="text" id={id} name={id} value={formData[id]} onChange={handleChange} className={inputClass(id)} placeholder={placeholder} />
                </div>
                {errors[id] && <p className="mt-1 text-sm text-red-600">{errors[id]}</p>}
              </div>
            ))}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Mail className="h-5 w-5 text-gray-400" /></div>
                <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} className={inputClass('email')} placeholder="Enter your email" />
              </div>
              {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
            </div>

            {[
              { id: 'password', label: 'Password', show: showPassword, toggle: () => setShowPassword(!showPassword), placeholder: 'Create a password' },
              { id: 'confirmPassword', label: 'Confirm Password', show: showConfirmPassword, toggle: () => setShowConfirmPassword(!showConfirmPassword), placeholder: 'Confirm your password' },
            ].map(({ id, label, show, toggle, placeholder }) => (
              <div key={id}>
                <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Lock className="h-5 w-5 text-gray-400" /></div>
                  <input type={show ? 'text' : 'password'} id={id} name={id} value={formData[id]} onChange={handleChange} className={`w-full pl-10 pr-12 py-3 border rounded-lg focus:ring-2 focus:ring-black focus:border-transparent transition-colors ${errors[id] ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} placeholder={placeholder} />
                  <button type="button" onClick={toggle} className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    {show ? <EyeOff className="h-5 w-5 text-gray-400" /> : <Eye className="h-5 w-5 text-gray-400" />}
                  </button>
                </div>
                {errors[id] && <p className="mt-1 text-sm text-red-600">{errors[id]}</p>}
              </div>
            ))}

            {errors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{errors.submit}</p>
              </div>
            )}

            <p className="text-sm text-gray-600">
              By creating an account, you agree to our <span className="text-gray-900 underline cursor-default">Terms of Service</span> and <span className="text-gray-900 underline cursor-default">Privacy Policy</span>
            </p>

            <button type="submit" disabled={loading}
              className="w-full bg-black text-white py-3 px-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />Creating Account...
                </div>
              ) : 'Create Account'}
            </button>
          </form>

          <div className="text-center mt-6 pt-6 border-t border-gray-200">
            <p className="text-gray-600 text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-gray-900 hover:opacity-80 font-medium">Sign In</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Register;
