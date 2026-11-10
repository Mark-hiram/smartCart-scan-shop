import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PortalType } from '../types';
import {
  ShoppingCart,
  Store,
  ShieldCheck,
  Building2,
  Lock,
  Mail,
  Phone,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Users,
  Tag,
  KeyRound,
  Shield,
} from 'lucide-react';

interface PortalLoginViewProps {
  portal: PortalType;
  onSwitchPortal: (portal: PortalType) => void;
  onContinueAsGuest?: () => void;
}

export const PortalLoginView: React.FC<PortalLoginViewProps> = ({
  portal,
  onSwitchPortal,
  onContinueAsGuest,
}) => {
  const { login, register, quickLogin } = useAuth();
  const { t } = useTranslation();

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

  // Portal metadata styling
  const portalMeta = {
    shopper: {
      title: t.portalShopper,
      subtitle: t.portalShopperSubtitle,
      description: t.portalShopperDesc,
      icon: <ShoppingCart className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />,
      themeBg: 'bg-emerald-50 dark:bg-emerald-950/40',
      themeBorder: 'border-emerald-200 dark:border-emerald-800',
      badge: t.portalBadgeShopper,
      badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
    },
    staff: {
      title: t.portalStaff,
      subtitle: t.portalStaffSubtitle,
      description: t.portalStaffDesc,
      icon: <Store className="w-7 h-7 text-blue-600 dark:text-blue-400" />,
      themeBg: 'bg-blue-50 dark:bg-blue-950/40',
      themeBorder: 'border-blue-200 dark:border-blue-800',
      badge: t.portalBadgeStaff,
      badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300',
    },
    management: {
      title: t.portalManagement,
      subtitle: t.portalManagementSubtitle,
      description: t.portalManagementDesc,
      icon: <Building2 className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />,
      themeBg: 'bg-indigo-50 dark:bg-indigo-950/40',
      themeBorder: 'border-indigo-200 dark:border-indigo-800',
      badge: t.portalBadgeManagement,
      badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300',
    },
  }[portal];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    const res = await login(identifier, password);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Authentication failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    const res = await register(name, email, phone, password);
    setIsSubmitting(false);

    if (!res.success) {
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

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Portal Header Hero */}
        <div className={`p-6 border-b ${portalMeta.themeBorder} ${portalMeta.themeBg} transition-colors`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${portalMeta.badgeColor}`}>
              {portalMeta.badge}
            </span>

            {/* Portal Switcher Tabs */}
            <div className="flex items-center gap-1 bg-white/70 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => onSwitchPortal('shopper')}
                className={`p-1.5 rounded-lg text-xs transition ${
                  portal === 'shopper'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title={t.portalShopper}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onSwitchPortal('staff')}
                className={`p-1.5 rounded-lg text-xs transition ${
                  portal === 'staff'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title={t.portalStaff}
              >
                <Store className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onSwitchPortal('management')}
                className={`p-1.5 rounded-lg text-xs transition ${
                  portal === 'management'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title={t.portalManagement}
              >
                <Building2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl shadow-xs border border-slate-200/60 dark:border-slate-800">
              {portalMeta.icon}
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white">
                {portalMeta.title}
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {portalMeta.subtitle}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed">
            {portalMeta.description}
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Dedicated Quick Demo Logins for THIS Portal */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
              ⚡ Quick Demo Sign-In ({portalMeta.title}):
            </span>

            {portal === 'shopper' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('shopper')}
                  className="flex-1 py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <ShoppingCart className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Demo Shopper (Mary Wanjiku)</span>
                </button>
              </div>
            )}

            {portal === 'staff' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('staff')}
                  className="py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center gap-1.5 shadow-xs"
                >
                  <Tag className="w-3.5 h-3.5 text-blue-600" />
                  <span>Cashier / Staff Demo</span>
                </button>
                <button
                  type="button"
                  onClick={() => login('alice.stock@naivas.com', 'Staff123!')}
                  className="py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center gap-1.5 shadow-xs"
                >
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  <span>Stock Clerk Preset</span>
                </button>
              </div>
            )}

            {portal === 'management' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => quickLogin('owner')}
                  className="w-full py-2 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 text-xs font-semibold text-slate-800 dark:text-slate-200 active:scale-95 transition flex items-center justify-between shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Chain Owner Demo (Grace Wambui)</span>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-bold">Naivas Chain</span>
                </button>

                <a
                  href="/admin/login"
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', '/admin/login');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold active:scale-95 transition flex items-center justify-between shadow-xs cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>System Admin Portal (/admin/login)</span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                </a>
              </div>
            )}
          </div>

          {/* Mode 1: Login Form (Supports Email or Phone) */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.emailOrPhone}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={
                      portal === 'shopper'
                        ? 'e.g. shopper@gmail.com or +254712345678'
                        : portal === 'staff'
                        ? 'e.g. staff.westlands@naivas.com'
                        : 'e.g. owner@naivas.com or admin@smartcart.com'
                    }
                    required
                    className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t.password}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    {t.forgotPassword}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full h-12 rounded-xl text-white font-bold text-xs transition active:scale-98 shadow-md flex items-center justify-center gap-2 ${
                  portal === 'shopper'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    : portal === 'staff'
                    ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
                }`}
              >
                <span>{isSubmitting ? 'Verifying Credentials...' : `Sign In to ${portalMeta.title}`}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Shopper Registration Link or Guest continue */}
              {portal === 'shopper' ? (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
                  <div className="text-xs text-slate-500">
                    <span>New shopper? </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setErrorMsg(null);
                      }}
                      className="font-bold text-emerald-600 hover:underline"
                    >
                      {t.register}
                    </button>
                  </div>

                  {onContinueAsGuest && (
                    <button
                      type="button"
                      onClick={onContinueAsGuest}
                      className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                    >
                      {t.guestShopper}
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-[11px] text-slate-500 text-center">
                  {portal === 'staff'
                    ? 'Staff accounts are issued by your Supermarket Chain Owner.'
                    : 'Corporate access is restricted to verified Chain Owners & System Admins.'}
                </div>
              )}
            </form>
          )}

          {/* Mode 2: Shopper Self-Registration Form */}
          {mode === 'register' && portal === 'shopper' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.fullName}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jane Wambui"
                  required
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Email (Unique)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.wambui@example.com"
                  required
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Phone (Unique)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+254712345678"
                  required
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.password}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition active:scale-98 shadow-sm"
              >
                {isSubmitting ? 'Creating Shopper Account...' : t.register}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs font-semibold text-emerald-600 hover:underline"
                >
                  Already have an account? Sign In
                </button>
              </div>
            </form>
          )}

          {/* Mode 3: Forgot Password / OTP Reset */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <form onSubmit={handleRequestResetCode} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Enter Email or Phone for OTP Code
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="e.g. your email or phone"
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
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

              <form onSubmit={handleConfirmReset} className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.verificationCode}
                  </label>
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="6-digit OTP code"
                    required
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.newPassword}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
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

          {/* Switch Portal Selector at Footer */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 block mb-2">
              {t.selectPortal}:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onSwitchPortal('shopper')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  portal === 'shopper'
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <ShoppingCart className="w-4 h-4 text-emerald-600 mb-1" />
                <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                  {t.portalShopper.split(' ')[0]}
                </p>
                <p className="text-[9px] text-slate-400">Shoppers</p>
              </button>

              <button
                type="button"
                onClick={() => onSwitchPortal('staff')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  portal === 'staff'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Store className="w-4 h-4 text-blue-600 mb-1" />
                <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                  {t.portalStaff.split(' ')[0]}
                </p>
                <p className="text-[9px] text-slate-400">Cashiers</p>
              </button>

              <button
                type="button"
                onClick={() => onSwitchPortal('management')}
                className={`p-2.5 rounded-xl border text-left transition ${
                  portal === 'management'
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Building2 className="w-4 h-4 text-indigo-600 mb-1" />
                <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                  {t.portalManagement.split(' ')[0]}
                </p>
                <p className="text-[9px] text-slate-400">Owners</p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
