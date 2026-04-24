// Full-page OTP verification (navigated to after registration)
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { verifyOTP, resendOTP } from '../services/index';
import { handleApiError } from '../../../services/api-service/axios-client';
import { useAuth } from '../../../context/auth-context';
import { useToast } from '../../../hooks/use-toast';
import { ArrowLeft } from 'lucide-react';

const OTPVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { manualLogin } = useAuth();
  const { showToast } = useToast();

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState(3);
  const inputRefs = useRef([]);

  const email = location.state?.email;
  const message = location.state?.message;

  useEffect(() => { if (!email) navigate('/register'); }, [email, navigate]);
  useEffect(() => { inputRefs.current[0]?.focus(); }, []);
  useEffect(() => {
    if (countdown > 0) { const t = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(t); }
  }, [countdown]);

  const handleInputChange = (index, value) => {
    if (value.length > 1) return;
    const newOtp = [...otp]; newOtp[index] = value; setOtp(newOtp); setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (value && index === 5 && newOtp.every((d) => d !== '')) handleVerifyOTP(newOtp.join(''));
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) { setOtp(digits.split('')); setError(''); handleVerifyOTP(digits); }
  };

  const handleVerifyOTP = async (otpCode = null) => {
    const otpToVerify = otpCode || otp.join('');
    if (otpToVerify.length !== 6) { setError('Please enter all 6 digits'); return; }
    setLoading(true); setError('');
    try {
      const response = await verifyOTP(email, otpToVerify);
      if (response.success) {
        if (response.data.tokens) {
          localStorage.setItem('fitme_token', response.data.tokens.accessToken);
          localStorage.setItem('fitme_refresh_token', response.data.tokens.refreshToken);
        }
        if (response.data.user) localStorage.setItem('fitme_user', JSON.stringify(response.data.user));
        showToast('Email verified successfully! Welcome to FitMe!', 'success');
        manualLogin(response.data.user, response.data.tokens);
        navigate('/onboarding', { state: { message: 'Email verified successfully!', user: response.data.user } });
      }
    } catch (err) {
      const errorInfo = handleApiError(err);
      setError(errorInfo.message);
      if (errorInfo.attemptsRemaining !== undefined) setAttemptsRemaining(errorInfo.attemptsRemaining);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  const handleResendOTP = async () => {
    setResendLoading(true); setError('');
    try {
      const response = await resendOTP(email);
      if (response.success) {
        showToast('New OTP sent to your email', 'success');
        setCountdown(60); setAttemptsRemaining(3); setOtp(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err) { setError(handleApiError(err).message); }
    finally { setResendLoading(false); }
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (!email) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="mb-6">
          <button onClick={() => navigate('/register')} className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />Back to Registration
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 7.89a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Verify Your Email</h2>
          <p className="text-gray-600">We've sent a 6-digit verification code to</p>
          <p className="text-black font-medium break-all">{email}</p>
          {message && <p className="text-sm text-gray-500 mt-2">{message}</p>}
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3 text-center">Enter verification code</label>
            <div className="flex justify-center space-x-3">
              {otp.map((digit, index) => (
                <input key={index} ref={(el) => (inputRefs.current[index] = el)} type="text" inputMode="numeric" pattern="[0-9]" maxLength="1" value={digit}
                  onChange={(e) => handleInputChange(index, e.target.value)} onKeyDown={(e) => handleKeyDown(index, e)} onPaste={handlePaste}
                  className="w-12 h-12 text-center text-lg font-semibold border-2 border-gray-300 rounded-lg focus:border-black focus:ring-2 focus:ring-black/20 transition-colors"
                  disabled={loading}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
              {attemptsRemaining > 0 && <p className="text-xs text-red-600 mt-1">{attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining</p>}
            </div>
          )}

          <button onClick={() => handleVerifyOTP()} disabled={loading || otp.some((d) => !d)}
            className="w-full bg-black text-white py-3 px-4 rounded-lg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>

          <div className="text-center">
            <p className="text-sm text-gray-600 mb-3">Didn't receive the code?</p>
            <button onClick={handleResendOTP} disabled={resendLoading || countdown > 0}
              className="text-black hover:opacity-80 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendLoading ? 'Sending...' : countdown > 0 ? `Resend in ${formatTime(countdown)}` : 'Resend Code'}
            </button>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-gray-500">The code will expire in 5 minutes. Check your spam folder if you don't see it.</p>
      </div>
    </div>
  );
};

export default OTPVerificationPage;
