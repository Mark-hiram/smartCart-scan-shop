import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Mail,
  User as UserIcon,
  Copy,
  Check,
  ArrowRight,
  AlertCircle,
  CheckCircle,
  KeyRound,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';

interface AdminLoginViewProps {
  onSuccess?: () => void;
  initialMode?: 'setup' | 'login' | 'recovery';
}

export const AdminLoginView: React.FC<AdminLoginViewProps> = ({ onSuccess, initialMode }) => {
  const { user, login, setupAdmin, changeFirstPassword, setupStatus, checkSetupStatus } = useAuth();
  const { t } = useTranslation();

  const [mode, setMode] = useState<'setup' | 'login' | 'forgot' | 'reset-token'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Temporary password displayed once
  const [generatedTempPassword, setGeneratedTempPassword] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  // Force password change on first login
  const [currentTempPassword, setCurrentTempPassword] = useState('');
  const [newPermanentPassword, setNewPermanentPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showForcePasswordModal, setShowForcePasswordModal] = useState(false);

  // Recovery link token state
  const [resetToken, setResetToken] = useState<string>('');
  const [recoveryLinkGenerated, setRecoveryLinkGenerated] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check setup status and resetToken in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('resetToken');
    if (tokenFromUrl) {
      setResetToken(tokenFromUrl);
      setMode('reset-token');
    }

    checkSetupStatus().then((status) => {
      if (status && !status.hasAdmin) {
        setMode('setup');
      } else if (initialMode === 'setup' && status?.hasAdmin) {
        setMode('login');
      }
    });
  }, [initialMode]);

  // If logged in and must change password, trigger mandatory modal
  useEffect(() => {
    if (user && user.role === 'admin' && user.mustChangePassword) {
      setShowForcePasswordModal(true);
    }
  }, [user]);

  // 1. First-time Admin Setup Handler
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    const res = await setupAdmin(email, name);
    setIsSubmitting(false);

    if (res.success && res.tempPassword) {
      setGeneratedTempPassword(res.tempPassword);
      setSuccessMsg('System Administrator initialized successfully.');
    } else {
      setErrorMsg(res.error || 'Setup failed');
    }
  };

  // 2. Admin Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    const res = await login(email, password);
    setIsSubmitting(false);

    if (res.success) {
      if (res.mustChangePassword) {
        setCurrentTempPassword(password);
        setShowForcePasswordModal(true);
      } else if (onSuccess) {
        onSuccess();
      }
    } else {
      setErrorMsg(res.error || 'Login failed');
    }
  };

  // 3. First-Time Password Change Handler (Mandatory)
  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPermanentPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPermanentPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    if (currentTempPassword === newPermanentPassword) {
      setErrorMsg('New password cannot be the same as the temporary password.');
      return;
    }

    setIsSubmitting(true);
    const res = await changeFirstPassword(currentTempPassword, newPermanentPassword);
    setIsSubmitting(false);

    if (res.success) {
      setShowForcePasswordModal(false);
      setSuccessMsg(res.message || 'Password successfully updated.');
      if (onSuccess) onSuccess();
    } else {
      setErrorMsg(res.error || 'Failed to update password');
    }
  };

  // 4. Time-Limited Recovery Link Request (Email Only)
  const handleRequestRecoveryLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email }),
      });
      const data = await res.json();
      setIsSubmitting(false);

      if (res.ok) {
        setSuccessMsg(data.message || t.adminRecoveryLinkDispatched);
        if (data.resetLink) {
          setRecoveryLinkGenerated(data.resetLink);
          if (data.demoCode) {
            setResetToken(data.demoCode);
          }
        }
      } else {
        setErrorMsg(data.error || 'Failed to request recovery link');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Network error');
    }
  };

  // 5. Reset Password using Time-Limited Token
  const handleResetWithToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPermanentPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPermanentPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/reset-password-with-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: newPermanentPassword }),
      });
      const data = await res.json();
      setIsSubmitting(false);

      if (res.ok) {
        setSuccessMsg(data.message);
        setMode('login');
        setPassword(newPermanentPassword);
        // Clear reset token from URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        setErrorMsg(data.error || 'Failed to reset password');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Network error');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 3000);
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Top Header Hero */}
        <div className="p-6 bg-slate-900 text-white border-b border-slate-800 relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
            <Shield className="w-48 h-48" />
          </div>

          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              System Administration
            </span>

            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>/admin/login</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-2xl shadow-inner border border-white/10">
              <ShieldCheck className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">
                {mode === 'setup'
                  ? t.firstTimeAdminSetup
                  : mode === 'forgot'
                  ? 'Administrator Password Recovery'
                  : mode === 'reset-token'
                  ? t.resetPasswordWithLink
                  : t.adminLoginTitle}
              </h1>
              <p className="text-xs text-slate-300 font-medium">
                {mode === 'setup'
                  ? t.singleAdminRule
                  : t.adminLoginSubtitle}
              </p>
            </div>
          </div>
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

          {/* ========================================================================= */}
          {/* MODE 1: FIRST-TIME SETUP (Shown ONCE when no admin exists)              */}
          {/* ========================================================================= */}
          {mode === 'setup' && (
            <div className="space-y-4">
              {!generatedTempPassword ? (
                <form onSubmit={handleSetup} className="space-y-3.5">
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{t.singleAdminRule}</span>
                    </p>
                    <p>{t.firstTimeAdminSetupDesc}</p>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      {t.adminEmailLabel} *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="[your email here]"
                        required
                        className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono focus:outline-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      {t.adminNameLabel}
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Lead Administrator"
                        className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition active:scale-98 shadow-md flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    <span>{isSubmitting ? 'Creating Administrator...' : t.generateTempPassword}</span>
                  </button>
                </form>
              ) : (
                /* SHOW TEMPORARY PASSWORD ONCE */
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500 text-slate-900 dark:text-white space-y-3">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs">
                      <ShieldAlert className="w-5 h-5 shrink-0" />
                      <span>{t.tempPasswordOnceNotice}</span>
                    </div>

                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-amber-300 dark:border-amber-700 flex items-center justify-between gap-2 shadow-inner">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">
                          TEMPORARY PASSWORD (ONE-TIME VIEW)
                        </span>
                        <code className="text-base font-black font-mono tracking-widest text-emerald-600 dark:text-emerald-400">
                          {generatedTempPassword}
                        </code>
                      </div>

                      <button
                        type="button"
                        onClick={() => copyToClipboard(generatedTempPassword)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition active:scale-95 shadow-xs"
                      >
                        {hasCopied ? (
                          <>
                            <Check className="w-4 h-4" />
                            <span>{t.passwordCopied}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>{t.copyPassword}</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                      <p>
                        • <strong>Permanent Admin Email:</strong> <code className="font-mono font-bold text-slate-900 dark:text-white">{email}</code>
                      </p>
                      <p>• You will be <strong>forced to change this password</strong> on your first sign-in at <code className="font-mono font-bold">/admin/login</code>.</p>
                      <p>• This password is now encrypted on the server and will <strong>never be shown again</strong>.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPassword(generatedTempPassword);
                      setMode('login');
                      setGeneratedTempPassword(null);
                    }}
                    className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition active:scale-98 shadow-md flex items-center justify-center gap-2"
                  >
                    <span>{t.goToAdminLogin}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODE 2: ADMIN SIGN-IN (NO REGISTRATION OPTION)                           */}
          {/* ========================================================================= */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.adminEmailLabel}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter registered admin email"
                    required
                    className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono focus:outline-emerald-500"
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
                    className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                  >
                    {t.forgotPassword}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password or temporary setup password"
                    required
                    className="w-full h-11 pl-9 pr-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 text-white font-bold text-xs transition active:scale-98 shadow-md flex items-center justify-center gap-2"
              >
                <span>{isSubmitting ? 'Authenticating...' : t.login}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* STRICT RULE NOTICE: No registration option */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 text-center space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  🔒 {t.adminRegistrationForbidden}
                </p>
                <p>{t.adminEmailRecoveryOnly}</p>
              </div>
            </form>
          )}

          {/* ========================================================================= */}
          {/* MODE 3: ADMIN PASSWORD RECOVERY (EMAIL ONLY WITH TIME-LIMITED LINK)       */}
          {/* ========================================================================= */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <form onSubmit={handleRequestRecoveryLink} className="space-y-3.5">
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200">
                  <p className="font-bold mb-1">Time-Limited Recovery Security Rule:</p>
                  <p>{t.adminEmailRecoveryOnly}</p>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.adminEmailLabel}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter registered admin email"
                    required
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-mono focus:outline-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition"
                >
                  {isSubmitting ? 'Generating Recovery Link...' : t.requestAdminResetLink}
                </button>
              </form>

              {/* Display Generated Recovery Link */}
              {recoveryLinkGenerated && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 space-y-2">
                  <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 block">
                    Simulated Email Dispatch (Expires in 15 Minutes):
                  </span>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs font-mono break-all">
                    <span>{window.location.origin}{recoveryLinkGenerated}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode('reset-token')}
                    className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Recovery Link Form Now</span>
                  </button>
                </div>
              )}

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Back to Sign-In
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODE 4: RESET PASSWORD WITH TIME-LIMITED TOKEN                            */}
          {/* ========================================================================= */}
          {mode === 'reset-token' && (
            <form onSubmit={handleResetWithToken} className="space-y-3.5">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                Verifying recovery token link. Please set your new permanent administrator password.
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Recovery Token
                </label>
                <input
                  type="text"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                  placeholder="Recovery token from link"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.newPermanentPassword}
                </label>
                <input
                  type="password"
                  value={newPermanentPassword}
                  onChange={(e) => setNewPermanentPassword(e.target.value)}
                  required
                  placeholder="Minimum 8 characters"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.confirmNewPassword}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Re-enter new password"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition active:scale-98 shadow-md"
              >
                {isSubmitting ? 'Updating Password...' : t.resetPassword}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MANDATORY MODAL: FORCE PASSWORD CHANGE ON FIRST SIGN-IN                    */}
      {/* ========================================================================= */}
      {showForcePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 border-emerald-500 overflow-hidden">
            <div className="p-5 bg-emerald-600 text-white">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-5 h-5 text-emerald-200" />
                <h3 className="text-base font-bold tracking-tight">
                  {t.forcePasswordChangeTitle}
                </h3>
              </div>
              <p className="text-xs text-emerald-100 leading-relaxed">
                {t.forcePasswordChangeSubtitle}
              </p>
            </div>

            <form onSubmit={handleForceChangePassword} className="p-5 space-y-3.5">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.currentTempPassword}
                </label>
                <input
                  type="password"
                  value={currentTempPassword}
                  onChange={(e) => setCurrentTempPassword(e.target.value)}
                  required
                  placeholder="Enter temporary password"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.newPermanentPassword}
                </label>
                <input
                  type="password"
                  value={newPermanentPassword}
                  onChange={(e) => setNewPermanentPassword(e.target.value)}
                  required
                  placeholder="Minimum 8 characters"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.confirmNewPassword}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Confirm new permanent password"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition active:scale-98 shadow-md"
              >
                {isSubmitting ? 'Securing Account...' : t.changePasswordButton}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
