// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PortalType } from '../types';
import { SmartCartSignInLogo } from './SmartCartLogo';
import { CopyrightBadge } from './CopyrightBadge';
import { PortalBackgroundImage, usePreloadPortalSignInImage } from './PortalBackgroundImage';
import { LEGAL_CONFIG } from '../config/legal';
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
  onOpenAdminLogin?: () => void;
  onOpenWelcome?: () => void;
}

export const PortalLoginView: React.FC<PortalLoginViewProps> = ({
  portal,
  onSwitchPortal,
  onContinueAsGuest,
  onOpenAdminLogin,
  onOpenWelcome,
}) => {
  const { login, register } = useAuth();
  const { t, language } = useTranslation();

  usePreloadPortalSignInImage(portal);

  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'apply'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [resetFullName, setResetFullName] = useState('');
  const [resetNote, setResetNote] = useState('');

  // Supermarket application state
  const [chainName, setChainName] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [city, setCity] = useState('');
  const [firstBranchName, setFirstBranchName] = useState('');
  const [initialProductCount, setInitialProductCount] = useState('');
  const [notes, setNotes] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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
    const res = await login(identifier, password, portal);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Authentication failed');
    }
  };

  const handleApplySupermarket = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/supermarket/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainName,
          contactEmail,
          contactPhone,
          city,
          firstBranchName,
          initialProductCount: initialProductCount ? parseInt(initialProductCount) : 0,
          notes,
          password: ownerPassword,
          ownerName: applicantName,
          language,
        }),
      });
      const data = await res.json();
      setIsSubmitting(false);
      if (res.ok) {
        setSuccessMsg(data.message || 'Application submitted. The Smart Cart team will review your application. Once approved, you will be able to sign in.');
        setMode('login');
      } else {
        setErrorMsg(data.error || 'Failed to submit application.');
      }
    } catch (e: any) {
      setIsSubmitting(false);
      setErrorMsg(e.message || 'Network error.');
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
          portal,
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
    <div className="portal-login-canvas min-h-dvh flex items-center justify-center p-4 sm:py-8">
      <PortalBackgroundImage portal={portal} variant="backdrop" priority />

      <div className="relative z-10 w-full max-w-lg portal-surface-card bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
        {/* Portal Header Hero Banner */}
        <div className="portal-banner-surface relative overflow-hidden p-5 sm:p-6 border-b border-white/10 transition-colors">
          <PortalBackgroundImage portal={portal} variant="banner" />
          <div className="relative z-10">
          <div className="flex items-center justify-between mb-3 gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${
                portal === 'shopper'
                  ? 'bg-white/20 text-white border-white/25'
                  : 'bg-amber-400/20 text-amber-200 border-amber-300/35'
              }`}
            >
              {portalMeta.badge}
            </span>

            {/* Portal Switcher Tabs */}
            <div className="flex items-center gap-1 bg-slate-950/35 p-1 rounded-xl border border-white/15">
              <button
                type="button"
                onClick={() => onSwitchPortal('shopper')}
                className={`p-1.5 rounded-lg text-xs transition ${
                  portal === 'shopper'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'text-white/75 hover:text-white'
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
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-white/75 hover:text-white'
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
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-white/75 hover:text-white'
                }`}
                title={t.portalManagement}
              >
                <Building2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-white/20 shrink-0">
                  {portalMeta.icon}
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-black text-white tracking-tight">
                    {portalMeta.title}
                  </h1>
                  <p className="text-xs text-white/85 font-medium">
                    {portalMeta.subtitle}
                  </p>
                </div>
              </div>

              <p className="text-xs text-white/80 mt-2.5 leading-relaxed">
                {portalMeta.description}
              </p>
            </div>
          </div>
          </div>
        </div>

        <div className="p-6 space-y-4 bg-white dark:bg-slate-900">
          {mode !== 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.backLabel}</span>
            </button>
          )}
          {/* Centred Brand Logo Above Sign-In Form */}
          <SmartCartSignInLogo />

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
                        ? 'e.g. shopper@example.com or +254712345678'
                        : portal === 'staff'
                        ? 'e.g. staff@store.com'
                        : 'e.g. owner@store.com'
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
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-[11px] text-slate-500 text-center space-y-2">
                  <p>
                    {portal === 'staff'
                      ? 'Staff accounts are issued by your Supermarket Chain Owner.'
                      : 'Corporate access is restricted to verified Chain Owners.'}
                  </p>
                  {portal === 'management' && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span>Want to bring your store chain to Smart Cart? </span>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('apply');
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Register a supermarket
                      </button>
                    </div>
                  )}
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

          {/* Mode 3: Free Support-Assisted Password Reset Request */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                <h2 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{t.resetRequestTitle}</span>
                </h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t.resetRequestDesc}
                </p>
              </div>

              <form onSubmit={handleRequestPasswordReset} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.emailOrPhone} *
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={t.emailOrPhonePlaceholder}
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
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
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.optionalNoteLabel}
                  </label>
                  <textarea
                    rows={2}
                    value={resetNote}
                    onChange={(e) => setResetNote(e.target.value)}
                    placeholder={t.optionalNotePlaceholder}
                    maxLength={500}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
                >
                  {isSubmitting ? t.submittingRequest : t.submitResetRequest}
                </button>
              </form>

              {/* Support Contact Details */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
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

          {/* Mode 4: Supermarket Chain Application Form */}
          {mode === 'apply' && portal === 'management' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-900 dark:text-indigo-200">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <span>Register a Supermarket Chain</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Submit your chain details for administrative verification. Once approved by the Smart Cart platform admin, you will receive full owner access to configure your branches, staff, catalog, and promotions.
                </p>
              </div>

              <form onSubmit={handleApplySupermarket} className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Supermarket Chain Name *
                    </label>
                    <input
                      type="text"
                      value={chainName}
                      onChange={(e) => setChainName(e.target.value)}
                      placeholder="e.g. Metro Supermarkets"
                      required
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                        Contact Email *
                      </label>
                      <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="owner@store.com"
                        required
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                        Contact Phone *
                      </label>
                      <input
                        type="tel"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="+254712345678"
                        required
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                        City / Region of 1st Branch *
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Nairobi"
                        required
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                        First Branch Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={firstBranchName}
                        onChange={(e) => setFirstBranchName(e.target.value)}
                        placeholder="e.g. Central Branch"
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                    </div>
                  </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Owner Account Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={applicantName}
                      onChange={(e) => setApplicantName(e.target.value)}
                      placeholder="e.g. John Kamau"
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Initial Product Count (Optional)
                    </label>
                    <input
                      type="number"
                      value={initialProductCount}
                      onChange={(e) => setInitialProductCount(e.target.value)}
                      placeholder="e.g. 500"
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Owner Password * (min 8 characters)
                  </label>
                  <input
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="Create a secure owner password"
                    required
                    minLength={8}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Additional Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Provide any details about your store POS or inventory..."
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition active:scale-98 flex items-center justify-center gap-2"
                >
                  <span>{isSubmitting ? 'Submitting Application...' : 'Submit Supermarket Application'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Already have an account? Back to Sign In
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Switch Portal Selector at Footer */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400">
                {t.selectPortal}:
              </span>
              <button
                type="button"
                onClick={() => {
                  if (onOpenAdminLogin) {
                    onOpenAdminLogin();
                  } else {
                    window.history.pushState({}, '', '/admin/login');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                }}
                title={t.adminLoginTitle}
                aria-label="System Admin Login"
                className="p-1 rounded-md text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <Shield className="w-3 h-3" />
              </button>
            </div>
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

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center gap-2 text-slate-600 dark:text-slate-400">
            {onOpenWelcome && (
              <button
                type="button"
                onClick={onOpenWelcome}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded px-1.5 py-0.5"
              >
                {t.aboutSmartCartLink}
              </button>
            )}
            <CopyrightBadge />
          </div>
        </div>
      </div>
    </div>
  );
};
