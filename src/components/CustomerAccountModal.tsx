import React, { useState, useEffect } from 'react';
import {
  User as UserIcon,
  Mail,
  Phone,
  Shield,
  Sparkles,
  Award,
  Calendar,
  X,
  CheckCircle2,
  LogIn,
  UserPlus,
  ArrowRight,
  Store,
  RefreshCw,
  ShoppingBag,
  ExternalLink,
  Users,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  CreditCard,
  Hash,
  AlertCircle,
  LogOut,
} from 'lucide-react';
import { User, Supermarket, CustomerLoyalty } from '../types.ts';
import { api } from '../api.ts';

interface CustomerAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUserChanged: (user: User) => void;
  currentSupermarket: Supermarket | null;
  loyalty: CustomerLoyalty | null;
  onRefreshLoyalty: (customerId: string) => void;
  onSignOut?: () => void;
}

export const CustomerAccountModal: React.FC<CustomerAccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChanged,
  currentSupermarket,
  loyalty,
  onRefreshLoyalty,
  onSignOut,
}) => {
  const [mode, setMode] = useState<'profile' | 'signin' | 'register' | 'forgot'>('profile');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [idNumberInput, setIdNumberInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState<{ email: string; newPassword?: string; name: string } | null>(null);
  const [savedCustomers, setSavedCustomers] = useState<User[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadRegisteredCustomers();
      setErrorMsg('');
      setSuccessMsg('');
      setForgotSuccess(null);
    }
  }, [isOpen]);

  const loadRegisteredCustomers = async () => {
    try {
      const res = await api.listCustomers();
      if (res.success) {
        setSavedCustomers(res.customers);
      }
    } catch (e) {
      console.error('Failed to load registered customers:', e);
    }
  };

  if (!isOpen) return null;

  const handleSignInWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address (e.g. shopper@gmail.com).');
      return;
    }

    setLoading(true);
    try {
      const res = await api.customerLogin(cleanEmail, passwordInput.trim() || undefined);
      if (res.success && res.user) {
        onUserChanged(res.user);
        onRefreshLoyalty(res.user.id);
        setSuccessMsg(`Welcome back, ${res.user.name}! Account linked with ${res.user.email}`);
        setMode('profile');
        setPasswordInput('');
        loadRegisteredCustomers();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to sign in. Please verify your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterNewAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanName = nameInput.trim();

    if (!cleanName) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.customerRegister(
        cleanName,
        cleanEmail,
        phoneInput.trim() || undefined,
        idNumberInput.trim() || undefined,
        passwordInput.trim() || 'cust123'
      );
      if (res.success && res.user) {
        onUserChanged(res.user);
        onRefreshLoyalty(res.user.id);
        setSuccessMsg(`Account created successfully and linked to ${res.user.email}!`);
        setMode('profile');
        setEmailInput('');
        setNameInput('');
        setPhoneInput('');
        setIdNumberInput('');
        setPasswordInput('');
        loadRegisteredCustomers();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed. Check if email is already in use.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async (googleEmail?: string, googleName?: string) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    const targetEmail = (googleEmail || emailInput || 'customer.google@gmail.com').trim().toLowerCase();
    const targetName = googleName || (targetEmail.split('@')[0].replace('.', ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

    try {
      const res = await api.customerGoogleAuth(targetEmail, targetName);
      if (res.success && res.user) {
        onUserChanged(res.user);
        onRefreshLoyalty(res.user.id);
        setSuccessMsg(`Google Authentication successful! Linked to ${res.user.email}`);
        setMode('profile');
        loadRegisteredCustomers();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Google sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setForgotSuccess(null);

    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter your registered customer email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.customerForgotPassword(cleanEmail);
      if (res.success) {
        setForgotSuccess({
          email: res.email,
          newPassword: res.newPassword,
          name: res.name,
        });
        loadRegisteredCustomers();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'No account found with this email.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSwitch = async (cust: User) => {
    setLoading(true);
    setErrorMsg('');
    try {
      onUserChanged(cust);
      onRefreshLoyalty(cust.id);
      setSuccessMsg(`Switched to account linked with: ${cust.email}`);
      setMode('profile');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to switch customer.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 text-white p-5 sm:p-6 relative shrink-0">
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSignOut();
                }}
                className="px-2.5 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold transition flex items-center gap-1 shadow-sm active:scale-95 border border-rose-400"
                title="Log Out of this customer account"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-emerald-950 flex items-center justify-center font-black shadow-lg">
              <Mail className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2 py-0.5 rounded-md">
                  Customer Account
                </span>
                <span className="text-[10px] font-mono text-emerald-200">
                  Email-Linked Profile
                </span>
              </div>
              <h2 className="text-xl font-black tracking-tight mt-0.5">Shopper Portal &amp; Identity</h2>
            </div>
          </div>
          <p className="text-xs text-emerald-200/90 mt-2">
            Every customer has an account linked with their email for tracking self-checkout scans, receipts, and loyalty SmartPoints.
          </p>

          {/* Nav Tabs */}
          <div className="flex gap-1 mt-4 bg-emerald-950/70 p-1 rounded-xl text-xs font-bold border border-emerald-800/80 overflow-x-auto">
            <button
              onClick={() => {
                setMode('profile');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 min-w-[70px] py-1.5 px-2.5 rounded-lg transition flex items-center justify-center gap-1 ${
                mode === 'profile'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>Profile</span>
            </button>
            <button
              onClick={() => {
                setMode('signin');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 min-w-[70px] py-1.5 px-2.5 rounded-lg transition flex items-center justify-center gap-1 ${
                mode === 'signin'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Log In</span>
            </button>
            <button
              onClick={() => {
                setMode('register');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 min-w-[70px] py-1.5 px-2.5 rounded-lg transition flex items-center justify-center gap-1 ${
                mode === 'register'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
            <button
              onClick={() => {
                setMode('forgot');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className={`flex-1 min-w-[100px] py-1.5 px-2.5 rounded-lg transition flex items-center justify-center gap-1 ${
                mode === 'forgot'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Forgot Pwd</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-slate-800 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* VIEW: CURRENT PROFILE */}
          {mode === 'profile' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-slate-50 to-slate-100/70 rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-800 text-amber-300 flex items-center justify-center font-black text-lg border-2 border-amber-400 shadow">
                      {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-black text-slate-900 text-base">{currentUser.name}</h3>
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.2 rounded-full">
                          Verified Shopper
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-600 mt-0.5 font-medium">
                        <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="font-semibold text-slate-900 select-all">{currentUser.email}</span>
                      </div>
                      {currentUser.phone && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{currentUser.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-1 rounded-lg border border-slate-200">
                      ID: {currentUser.id_number || currentUser.id.slice(0, 10)}
                    </span>
                    {onSignOut && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onSignOut();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold transition flex items-center gap-1 shadow-2xs active:scale-95"
                        title="Log out and return to guest mode"
                      >
                        <LogOut className="w-3 h-3 text-rose-600" />
                        <span>Log Out</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Additional Customer Details: National ID, Logins Count, Password Status */}
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-200/80 text-xs">
                  <div className="bg-white p-2 rounded-xl border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <CreditCard className="w-3 h-3 text-slate-400" />
                      <span>National ID</span>
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {currentUser.id_number || 'Not specified'}
                    </span>
                  </div>
                  <div className="bg-white p-2 rounded-xl border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Hash className="w-3 h-3 text-slate-400" />
                      <span>Total Logins</span>
                    </span>
                    <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {currentUser.login_count || 1} logins
                    </span>
                  </div>
                </div>

                {/* Email Linking Status Banner */}
                <div className="mt-2 pt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Shopping sessions &amp; receipts linked to this email</span>
                  </span>
                  <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    Account Active
                  </span>
                </div>
              </div>

              {/* Loyalty & Shopping Stats tied to this email */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
                      Loyalty Balance
                    </span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <div className="text-2xl font-black text-amber-950 font-mono">
                    {loyalty?.total_points || 0}{' '}
                    <span className="text-xs font-bold text-amber-700">SmartPoints</span>
                  </div>
                  <div className="text-[11px] text-amber-800 mt-0.5 font-medium">
                    Worth KSh {(loyalty?.points_value_ksh || 0).toLocaleString()} discount
                  </div>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
                      Member Tier
                    </span>
                    <Award className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-emerald-950">
                    {loyalty?.tier || 'Bronze'}
                  </div>
                  <div className="text-[11px] text-emerald-800 mt-0.5 font-medium">
                    {loyalty?.completed_sessions_count || 0} shopping sessions completed
                  </div>
                </div>
              </div>

              {/* Switch / Sign In / Register Shortcuts */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-800">Use a different customer account?</p>
                  <p className="text-[11px] text-slate-500">
                    Log in with another email or register a new shopper account.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setMode('signin')}
                    className="px-2.5 py-1.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold transition flex items-center gap-1"
                  >
                    <span>Log In</span>
                  </button>
                  <button
                    onClick={() => setMode('register')}
                    className="px-2.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 text-xs font-bold transition flex items-center gap-1"
                  >
                    <span>Sign Up</span>
                  </button>
                </div>
              </div>

              {/* Saved customer accounts on this system */}
              {savedCustomers.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>Registered Shopper Accounts ({savedCustomers.length})</span>
                  </p>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {savedCustomers.map((cust) => {
                      const isCurrent = cust.id === currentUser.id || cust.email.toLowerCase() === currentUser.email.toLowerCase();
                      return (
                        <div
                          key={cust.id}
                          className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 ${
                            isCurrent
                              ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-400'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 truncate">{cust.name}</span>
                              {isCurrent && (
                                <span className="text-[9px] font-bold bg-emerald-600 text-white px-1.5 py-0.2 rounded">
                                  Current
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 font-mono truncate">{cust.email}</p>
                          </div>

                          {!isCurrent && (
                            <button
                              onClick={() => handleQuickSwitch(cust)}
                              disabled={loading}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-400 hover:text-emerald-950 text-slate-700 text-xs font-bold transition shrink-0"
                            >
                              Switch
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: LOG IN */}
          {mode === 'signin' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 leading-relaxed">
                Log in with your customer email address and password. Your shopping sessions, cart items, and loyalty SmartPoints will be loaded immediately.
              </div>

              {/* 1-Click Google Sign In */}
              <button
                type="button"
                onClick={() => handleGoogleAuth()}
                disabled={loading}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border-2 border-slate-300 text-slate-800 font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2.5 active:scale-[0.98]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Or use email &amp; password</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <form onSubmit={handleSignInWithEmail} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Customer Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="e.g. customer@smartcart.co.ke"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Password <span className="text-slate-400 font-normal lowercase">(default: cust123)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setErrorMsg('');
                        setSuccessMsg('');
                      }}
                      className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setMode('profile')}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {loading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    <span>Log In to Account</span>
                  </button>
                </div>
              </form>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">Don&apos;t have an account yet? </span>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-xs font-bold text-emerald-800 hover:underline"
                >
                  Create one now
                </button>
              </div>
            </div>
          )}

          {/* VIEW: REGISTER / SIGN UP */}
          {mode === 'register' && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900">
                Create your customer account. All scans, digital receipts, and loyalty SmartPoints will be permanently linked to this email address.
              </div>

              {/* 1-Click Google Sign Up */}
              <button
                type="button"
                onClick={() => handleGoogleAuth()}
                disabled={loading}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border-2 border-slate-300 text-slate-800 font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2.5 active:scale-[0.98]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Sign Up with Google</span>
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Or register with details</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <form onSubmit={handleRegisterNewAccount} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="e.g. Daniel Kamau"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="e.g. daniel.kamau@gmail.com"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      National / ID No.
                    </label>
                    <div className="relative">
                      <CreditCard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={idNumberInput}
                        onChange={(e) => setIdNumberInput(e.target.value)}
                        placeholder="e.g. 29384751"
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="+254 7..."
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Password (Optional, default: cust123)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Set account password"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setMode('profile')}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-black text-xs shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {loading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span>Create Account</span>
                  </button>
                </div>
              </form>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">Already registered? </span>
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className="text-xs font-bold text-emerald-800 hover:underline"
                >
                  Log in here
                </button>
              </div>
            </div>
          )}

          {/* VIEW: FORGOT PASSWORD */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                  <span>Receive New Password via Email</span>
                </div>
                Enter your customer email. The system will automatically generate a new secure password and dispatch it to your email address so you can access your account.
              </div>

              {forgotSuccess ? (
                <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>New Password Dispatched to Your Email!</span>
                  </div>
                  <div className="text-xs text-emerald-800 space-y-1">
                    <p>
                      Hello <strong>{forgotSuccess.name}</strong>, we sent a new password to:
                    </p>
                    <p className="font-mono font-bold bg-white p-2 rounded-lg border border-emerald-200 text-emerald-950">
                      {forgotSuccess.email}
                    </p>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Generated Password:
                    </span>
                    <span className="text-base font-black font-mono text-emerald-900 bg-emerald-100 px-2.5 py-1 rounded-md inline-block select-all">
                      {forgotSuccess.newPassword}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEmailInput(forgotSuccess.email);
                      setPasswordInput(forgotSuccess.newPassword || '');
                      setMode('signin');
                      setForgotSuccess(null);
                    }}
                    className="w-full py-2.5 bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-2"
                  >
                    <span>Proceed to Sign In with New Password</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Your Registered Customer Email <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="e.g. customer@smartcart.co.ke"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setMode('signin')}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition"
                    >
                      Back to Sign In
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {loading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="w-3.5 h-3.5" />
                      )}
                      <span>Send New Password</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Connected Supermarket: <strong className="text-slate-800">{currentSupermarket?.name || 'None (Connect in Store)'}</strong></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 font-bold text-slate-700 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
