// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState } from 'react';
import { X, Lock, Mail, Phone, User as UserIcon, AlertCircle, CheckCircle, ShieldCheck, ShoppingCart, Store, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PortalType } from '../types';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { LEGAL_CONFIG } from '../config/legal';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  portal?: PortalType;
  onSwitchPortal?: (portal: PortalType) => void;
  onOpenAdminLogin?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, portal = 'shopper', onSwitchPortal, onOpenAdminLogin }) => {
  const { login, register } = useAuth();
  const { t, language } = useTranslation();

  useBodyScrollLock(isOpen);

  const [activePortalTab, setActivePortalTab] = useState<PortalType>(portal);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [resetFullName, setResetFullName] = useState('');
  const [resetNote, setResetNote] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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
    const res = await login(identifier, password, activePortalTab);
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

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          fullName: resetFullName,
          note: resetNote,
          portal: activePortalTab,
        }),
      });
      const data = await res.json();
      setIsSubmitting(false);
      if (res.ok) {
        setSuccessMsg(data.message || 'If we find your account, support will contact you shortly.');
        setResetFullName('');
        setResetNote('');
      } else {
        setErrorMsg(data.error || 'Could not submit password reset request.');
      }
    } catch (e: any) {
      setIsSubmitting(false);
      setErrorMsg(e.message || 'Network error.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header with Title and Close Button */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
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
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Portals Switcher Tab within Modal */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {t.selectPortal}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenAdminLogin) {
                  onOpenAdminLogin();
                } else {
                  window.history.pushState({}, '', '/admin/login');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
              title={t.adminLoginTitle}
              aria-label="System Admin Login"
              className="p-1 rounded-md text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition"
            >
              <ShieldCheck className="w-3 h-3" />
            </button>
          </div>
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

        <div className="p-5 overflow-y-auto overscroll-y-contain flex-1 min-h-0 space-y-4">
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
                      ? 'e.g. shopper@example.com or +254712345678'
                      : activePortalTab === 'staff'
                      ? 'e.g. staff@store.com'
                      : 'e.g. owner@store.com'
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

          {/* Mode 3: Free Support-Assisted Password Reset Request */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                <p className="text-xs font-bold text-slate-900 dark:text-white">{t.resetRequestTitle}</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t.resetRequestDesc}
                </p>
              </div>

              <form onSubmit={handleRequestPasswordReset} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.emailOrPhone} *
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t.emailOrPhonePlaceholder}
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.fullName} *
                  </label>
                  <input
                    type="text"
                    value={resetFullName}
                    onChange={(e) => setResetFullName(e.target.value)}
                    placeholder="e.g. Jane Wambui"
                    required
                    minLength={2}
                    maxLength={120}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.optionalNoteLabel}
                  </label>
                  <textarea
                    rows={2}
                    value={resetNote}
                    onChange={(e) => setResetNote(e.target.value)}
                    placeholder={t.optionalNotePlaceholder}
                    maxLength={500}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                >
                  {isSubmitting ? t.submittingRequest : t.submitResetRequest}
                </button>
              </form>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                <p className="font-bold text-slate-800 dark:text-slate-200">{t.supportContactLabel}:</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-emerald-600" />
                    <a href={`mailto:${LEGAL_CONFIG.contactEmail}`} className="underline hover:text-emerald-600">
                      {LEGAL_CONFIG.contactEmail}
                    </a>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    <a href={`tel:${LEGAL_CONFIG.supportPhone.replace(/\s+/g, '')}`} className="underline hover:text-emerald-600">
                      {LEGAL_CONFIG.supportPhone}
                    </a>
                  </span>
                </div>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs text-slate-500 hover:underline"
                >
                  {t.backLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
