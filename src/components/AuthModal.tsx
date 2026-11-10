import React, { useState } from 'react';
import { X, Lock, Mail, Phone, User as UserIcon, AlertCircle, CheckCircle, ShieldCheck, ShoppingCart, Store, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PortalType } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  portal?: PortalType;
  onSwitchPortal?: (portal: PortalType) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, portal = 'shopper', onSwitchPortal }) => {
  const { login, register, quickLogin } = useAuth();
  const { t } = useTranslation();

  const [activePortalTab, setActivePortalTab] = useState<PortalType>(portal);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handlePortalChange = (p: PortalType) => {
    setActivePortalTab(p);
    if (onSwitchPortal) onSwitchPortal(p);
    if (p !== 'shopper' && mode === 'register') {
      setMode('login');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    const res = await login(identifier, password);
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    } else {
      setErrorMsg(res.error || 'Login failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    const res = await register(name, email, phone, password);
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    } else {
      setErrorMsg(res.error || 'Registration failed');
    }
  };

  const handleRequestResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      setIsSubmitting(false);
      if (res.ok) {
        setSuccessMsg(data.message);
        if (data.demoCode) {
          setDemoCode(data.demoCode);
          setResetCode(data.demoCode);
        }
      } else {
        setErrorMsg(data.error);
      }
    } catch (e: any) {
      setIsSubmitting(false);
      setErrorMsg(e.message);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, code: resetCode, newPassword }),
      });
      const data = await res.json();
      setIsSubmitting(false);
      if (res.ok) {
        setSuccessMsg(data.message);
        setPassword(newPassword);
        setMode('login');
      } else {
        setErrorMsg(data.error);
      }
    } catch (e: any) {
      setIsSubmitting(false);
      setErrorMsg(e.message);
    }
  };

  const handleDemoClick = async (role: 'owner' | 'staff' | 'shopper') => {
    setErrorMsg(null);
    setIsSubmitting(true);
    await quickLogin(role);
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header with Title and Close Button */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {mode === 'login'
                ? t.login
                : mode === 'register'
                ? t.register
                : t.resetPassword}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Portals Switcher Tab within Modal */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 px-1">
            {t.selectPortal}
          </span>
          <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs">
            <button
              type="button"
              onClick={() => handlePortalChange('shopper')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                activePortalTab === 'shopper'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>{t.portalShopper.split(' ')[0]}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePortalChange('staff')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                activePortalTab === 'staff'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>{t.portalStaff.split(' ')[0]}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePortalChange('management')}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${
                activePortalTab === 'management'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{t.portalManagement.split(' ')[0]}</span>
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Feedback messages */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Quick Demo Accounts Box relevant to active portal */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-2">
              ⚡ {t.demoAccounts} (One-tap test login):
            </span>

            {activePortalTab === 'shopper' && (
              <button
                type="button"
                onClick={() => handleDemoClick('shopper')}
                className="w-full py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-left text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-emerald-600" />
                  <span>🛒 Shopper (Mary Wanjiku)</span>
                </div>
                <span className="text-[10px] text-emerald-600 font-bold">Fast In-Store Scan</span>
              </button>
            )}

            {activePortalTab === 'staff' && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => handleDemoClick('staff')}
                  className="w-full py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-left text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-blue-600" />
                    <span>🏷️ Cashier (Westlands Branch)</span>
                  </div>
                  <span className="text-[10px] text-blue-600 font-bold">Till Verification</span>
                </button>
              </div>
            )}

            {activePortalTab === 'management' && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => handleDemoClick('owner')}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-left text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>🏢 Chain Owner Demo</span>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-bold">Naivas Chain</span>
                </button>

                <a
                  href="/admin/login"
                  onClick={(e) => {
                    e.preventDefault();
                    onClose();
                    window.history.pushState({}, '', '/admin/login');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold active:scale-95 transition flex items-center justify-between shadow-xs cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>System Admin Portal (/admin/login)</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold">1 Admin Policy →</span>
                </a>
              </div>
            )}
          </div>

          {/* Mode 1: Login Form (Dual field: Email or Phone in same input) */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.emailOrPhone}
                </label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={
                    activePortalTab === 'shopper'
                      ? 'e.g. shopper@gmail.com or +254712345678'
                      : activePortalTab === 'staff'
                      ? 'e.g. staff.westlands@naivas.com'
                      : 'e.g. owner@naivas.com or admin@smartcart.com'
                  }
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.password}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="text-[11px] text-emerald-600 hover:underline"
                  >
                    {t.forgotPassword}
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full h-11 rounded-xl text-white font-semibold text-xs transition active:scale-98 ${
                  activePortalTab === 'shopper'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : activePortalTab === 'staff'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {isSubmitting ? 'Authenticating...' : `${t.login} (${activePortalTab})`}
              </button>

              {activePortalTab === 'shopper' ? (
                <div className="text-center pt-2">
                  <span className="text-xs text-slate-500">Don't have an account? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="text-xs font-semibold text-emerald-600 hover:underline"
                  >
                    {t.register}
                  </button>
                </div>
              ) : (
                <div className="text-center pt-1 text-[11px] text-slate-400">
                  {activePortalTab === 'staff'
                    ? 'Staff accounts are managed by Chain Owners.'
                    : 'Owner & Admin corporate login portal.'}
                </div>
              )}
            </form>
          )}

          {/* Mode 2: Self-Register Form (Shoppers only) */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.fullName}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Email (Unique)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.doe@example.com"
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Phone Number (Unique)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+254712345678"
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.password}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition active:scale-98"
              >
                {isSubmitting ? 'Creating Account...' : t.register}
              </button>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">Already registered? </span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs font-semibold text-emerald-600 hover:underline"
                >
                  {t.login}
                </button>
              </div>
            </form>
          )}

          {/* Mode 3: Forgot Password / OTP Reset */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <form onSubmit={handleRequestResetCode} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Enter Email or Phone to receive OTP
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g. shopper@gmail.com"
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-xl bg-slate-800 text-white font-medium text-xs hover:bg-slate-700 transition"
                >
                  {t.sendResetCode}
                </button>
              </form>

              {demoCode && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                  Demo SMS/Email OTP Dispatched: <strong className="font-mono text-sm">{demoCode}</strong>
                </div>
              )}

              {/* Enter verification code & new password */}
              <form onSubmit={handleConfirmReset} className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.verificationCode}
                  </label>
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="6-digit code"
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono focus:outline-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.newPassword}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                >
                  {t.resetPassword}
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
