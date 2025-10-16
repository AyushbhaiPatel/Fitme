import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Loader, X } from 'lucide-react';
import { DELETE_MESSAGES } from '../hooks/use-delete-account';

const CONFIRM_PHRASE = 'DELETE';

const inputClass = (hasError) =>
  `w-full px-4 py-3 border rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 transition-colors ${
    hasError ? 'border-red-400' : 'border-[#EADFD0] hover:border-gray-400'
  }`;

// Asks for the current password and a typed confirmation, then calls `onDelete(password)`, which
// resolves to { ok } or { ok: false, field, message }. Errors render inline next to their field.
const DeleteAccountDialog = ({ isOpen, onClose, onDelete, isDeleting }) => {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const passwordRef = useRef(null);

  useEffect(() => {
    if (isOpen) passwordRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const close = () => {
    if (isDeleting) return;
    setPassword('');
    setConfirmText('');
    setShowPassword(false);
    setErrors({});
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isDeleting) return;

    const next = {};
    // Passwords are sent exactly as typed (no trimming): spaces can be part of a password.
    if (!password) next.password = DELETE_MESSAGES.PASSWORD_REQUIRED;
    if (confirmText.trim() !== CONFIRM_PHRASE) next.confirm = `Type ${CONFIRM_PHRASE} to confirm.`;
    setErrors(next);
    if (Object.keys(next).length) return;

    const result = await onDelete(password);
    if (result && !result.ok) {
      setErrors(result.field === 'password' ? { password: result.message } : { form: result.message });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        className="bg-white rounded-2xl border border-[#EADFD0] shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-[#EADFD0]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 id="delete-account-title" className="text-xl font-semibold text-gray-900">Delete your account</h2>
              <p className="text-sm text-gray-500">This cannot be undone.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isDeleting}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-[#FAF7F2] disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
          <p className="text-sm text-gray-700">
            This permanently deletes your account and all of its data: workout history, saved workout plans,
            meal plans and AI coach conversations.
          </p>

          <div className="space-y-2">
            <label htmlFor="delete-account-password" className="block text-sm font-medium text-gray-900">
              Current password
            </label>
            <div className="relative">
              <input
                id="delete-account-password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                disabled={isDeleting}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'delete-account-password-error' : undefined}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((prev) => ({ ...prev, password: undefined, form: undefined }));
                }}
                className={`${inputClass(!!errors.password)} pr-12`}
                placeholder="Enter your current password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p id="delete-account-password-error" role="alert" className="text-sm text-red-600">{errors.password}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="delete-account-confirm" className="block text-sm font-medium text-gray-900">
              Type {CONFIRM_PHRASE} to confirm
            </label>
            <input
              id="delete-account-confirm"
              type="text"
              autoComplete="off"
              value={confirmText}
              disabled={isDeleting}
              aria-invalid={!!errors.confirm}
              aria-describedby={errors.confirm ? 'delete-account-confirm-error' : undefined}
              onChange={(e) => {
                setConfirmText(e.target.value);
                setErrors((prev) => ({ ...prev, confirm: undefined, form: undefined }));
              }}
              className={inputClass(!!errors.confirm)}
              placeholder={CONFIRM_PHRASE}
            />
            {errors.confirm && (
              <p id="delete-account-confirm-error" role="alert" className="text-sm text-red-600">{errors.confirm}</p>
            )}
          </div>

          {errors.form && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errors.form}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={close}
              disabled={isDeleting}
              className="flex-1 px-4 py-3 border border-[#EADFD0] bg-white text-gray-900 rounded-xl hover:bg-[#FAF7F2] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeleting}
              aria-busy={isDeleting}
              className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" /> Deleting account...
                </>
              ) : (
                'Delete account permanently'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeleteAccountDialog;
