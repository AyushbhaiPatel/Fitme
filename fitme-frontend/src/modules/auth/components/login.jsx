import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../context/auth-context';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, ArrowLeft, AlertCircle, CheckCircle, Info, Clock, Shield, RefreshCw, HelpCircle } from 'lucide-react';
import OtpVerification from './email-verification-inline';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ email: location.state?.email || '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [, setLastError] = useState(null);
  const [, setRetryCount] = useState(0);
  const [showOTPVerification, setShowOTPVerification] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');

  const from = location.state?.from?.pathname || '/dashboard';

  useEffect(() => {
    if (location.state?.clearErrors) { setErrors({}); setLastError(null); }
  }, [location.state]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
    if (errors.submit && (name === 'email' || name === 'password')) setErrors((prev) => ({ ...prev, submit: null }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.email) newErrors.email = { message: 'Email address is required', type: 'required' };
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = { message: 'Please enter a valid email address', type: 'format' };
    if (!formData.password) newErrors.password = { message: 'Password is required', type: 'required' };
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getErrorIcon = (errorCode) => {
    switch (errorCode) {
      case 'EMAIL_NOT_FOUND': return <HelpCircle className="w-5 h-5 text-blue-500" />;
      case 'INVALID_PASSWORD': return <Shield className="w-5 h-5 text-orange-500" />;
      case 'ACCOUNT_LOCKED': return <Clock className="w-5 h-5 text-red-500" />;
      case 'EMAIL_NOT_VERIFIED': return <Info className="w-5 h-5 text-yellow-500" />;
      case 'SERVER_ERROR': return <RefreshCw className="w-5 h-5 text-gray-500" />;
      default: return <AlertCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getErrorColor = (errorCode) => {
    switch (errorCode) {
      case 'EMAIL_NOT_FOUND': return 'blue';
      case 'INVALID_PASSWORD': return 'orange';
      case 'ACCOUNT_LOCKED': return 'red';
      case 'EMAIL_NOT_VERIFIED': return 'yellow';
      case 'SERVER_ERROR': return 'gray';
      default: return 'red';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    setLastError(null);
    try {
      const result = await login(formData.email, formData.password);
      if (result.success) {
        navigate(result.onboarding ? '/onboarding' : from, { replace: true });
      } else {
        handleLoginError(result);
      }
    } catch {
      setErrors({ submit: { message: 'An unexpected error occurred. Please try again.', errorCode: 'UNEXPECTED_ERROR' } });
    } finally {
      setLoading(false);
    }
  };

  const handleLoginError = (errorResult) => {
    const errorInfo = typeof errorResult === 'string' ? { message: errorResult, errorCode: 'GENERIC_ERROR' } : errorResult;
    if (errorInfo.errorCode === 'EMAIL_NOT_VERIFIED') {
      setUnverifiedEmail(errorInfo.data?.email || formData.email);
      setShowOTPVerification(true);
      return;
    }
    setLastError(errorInfo);
    setRetryCount((prev) => prev + 1);
    setErrors({ submit: { message: errorInfo.message, errorCode: errorInfo.errorCode, suggestions: errorInfo.suggestions || [], attemptsRemaining: errorInfo.attemptsRemaining, timeRemaining: errorInfo.timeRemaining } });
  };

  const handleOTPSuccess = (data) => {
    navigate(data.user?.profileCompleted ? '/dashboard' : '/onboarding', { replace: true });
  };

  const renderErrorMessage = (error) => {
    if (!error) return null;
    const colorClass = getErrorColor(error.errorCode);
    return (
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
        className={`bg-${colorClass}-50 border-${colorClass}-200 border rounded-lg p-4 mb-4`}
      >
        <div className="flex items-start space-x-3">
          {getErrorIcon(error.errorCode)}
          <div className="flex-1">
            <p className={`text-sm font-medium text-${colorClass}-800`}>{error.message}</p>
            {error.attemptsRemaining !== undefined && <p className={`text-sm mt-1 text-${colorClass}-800`}><strong>{error.attemptsRemaining}</strong> attempts remaining</p>}
            {error.timeRemaining && <p className={`text-sm mt-1 text-${colorClass}-800`}>Try again in <strong>{error.timeRemaining} minutes</strong></p>}
            {error.suggestions?.length > 0 && (
              <ul className={`text-sm text-${colorClass}-800 mt-3 space-y-1`}>
                {error.suggestions.map((s, i) => <li key={i} className="flex items-start"><span className="mr-2">•</span><span>{s}</span></li>)}
              </ul>
            )}
            {error.errorCode === 'EMAIL_NOT_FOUND' && (
              <Link to="/register" className="mt-3 inline-flex items-center px-3 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-full hover:bg-blue-200">Create Account</Link>
            )}
            {(error.errorCode === 'INVALID_PASSWORD' || error.errorCode === 'ACCOUNT_LOCKED') && (
              <Link to="/forgot-password" className="mt-3 inline-flex items-center px-3 py-1 text-xs font-medium text-orange-700 bg-orange-100 rounded-full hover:bg-orange-200">Reset Password</Link>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  const renderFieldError = (fieldError) => {
    if (!fieldError) return null;
    return (
      <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-1">
        <p className="text-sm text-red-600 flex items-center"><AlertCircle className="w-4 h-4 mr-1" />{fieldError.message}</p>
      </motion.div>
    );
  };

  if (showOTPVerification) {
    return <OtpVerification email={unverifiedEmail} onSuccess={handleOTPSuccess} onBack={() => { setShowOTPVerification(false); setUnverifiedEmail(''); }} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="w-full max-w-md">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
          <Link to="/" className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />Back to Home
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
        >
          <div className="text-center mb-8">
            <div className="text-3xl font-bold text-gray-900 mb-2">FitMe+</div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">Welcome Back</h1>
            <p className="text-gray-600">Sign in to continue your fitness journey</p>
          </div>

          {location.state?.message && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <div className="flex items-center"><CheckCircle className="w-5 h-5 text-green-500 mr-2" /><p className="text-sm text-green-800">{location.state.message}</p></div>
            </motion.div>
          )}

          <AnimatePresence>{errors.submit && renderErrorMessage(errors.submit)}</AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className={`h-5 w-5 ${errors.email ? 'text-red-400' : 'text-gray-400'}`} />
                </div>
                <input type="email" id="email" name="email" value={formData.email} onChange={handleChange}
                  className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-black focus:border-transparent transition-all ${errors.email ? 'border-red-300 bg-red-50' : 'border-gray-300 hover:border-gray-400'}`}
                  placeholder="Enter your email address" autoComplete="email"
                />
              </div>
              {renderFieldError(errors.email)}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className={`h-5 w-5 ${errors.password ? 'text-red-400' : 'text-gray-400'}`} />
                </div>
                <input type={showPassword ? 'text' : 'password'} id="password" name="password" value={formData.password} onChange={handleChange}
                  className={`w-full pl-10 pr-12 py-3 border rounded-lg focus:ring-2 focus:ring-black focus:border-transparent transition-all ${errors.password ? 'border-red-300 bg-red-50' : 'border-gray-300 hover:border-gray-400'}`}
                  placeholder="Enter your password" autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center" tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-5 w-5 text-gray-400" /> : <Eye className="h-5 w-5 text-gray-400" />}
                </button>
              </div>
              {renderFieldError(errors.password)}
            </div>

            <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.98 }}
              className="w-full bg-black text-white py-3 px-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                  Signing In...
                </div>
              ) : 'Sign In'}
            </motion.button>
          </form>

          <div className="text-center mt-6">
            <Link to="/forgot-password" className="text-sm text-gray-900 hover:opacity-80 inline-flex items-center">
              <HelpCircle className="w-4 h-4 mr-1" />Forgot your password?
            </Link>
          </div>

          <div className="text-center mt-6 pt-6 border-t border-gray-200">
            <p className="text-gray-600 text-sm">
              Don't have an account?{' '}
              <Link to="/register" className="text-gray-900 hover:opacity-80 font-medium">Create Account</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
