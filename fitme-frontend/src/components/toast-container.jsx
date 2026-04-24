import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, CheckCircle } from 'lucide-react';

const Toast = ({ message, type = 'error', onClose }) => {
  const isSuccess = type === 'success';
  const Icon = isSuccess ? CheckCircle : AlertCircle;
  const styles = isSuccess
    ? { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'text-green-600' }
    : { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'text-red-600' };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={`${styles.bg} ${styles.border} border rounded-lg p-4 shadow-lg max-w-sm w-full`}
    >
      <div className="flex items-start space-x-3">
        <Icon className={`h-5 w-5 ${styles.icon} mt-0.5 flex-shrink-0`} />
        <p className={`text-sm font-medium ${styles.text} flex-1`}>{message}</p>
        <button onClick={onClose} className={`${styles.icon} hover:opacity-75`}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};

const ToastContainer = ({ toasts, onHideToast }) => (
  <div className="fixed top-4 right-4 z-[60] space-y-2">
    <AnimatePresence>
      {toasts.map((toast) => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => onHideToast(toast.id)} />
      ))}
    </AnimatePresence>
  </div>
);

export default ToastContainer;
