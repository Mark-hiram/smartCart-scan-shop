import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldAlert,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  KeyRound,
  Terminal,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api.ts';
import { User } from '../types.ts';

interface SystemAdminSignInProps {
  onSuccess: (user: User) => void;
  onSwitchToStoreAdmin: () => void;
  onBackToCustomer: () => void;
}

export const SystemAdminSignIn: React.FC<SystemAdminSignInProps> = ({
  onSuccess,
  onSwitchToStoreAdmin,
  onBackToCustomer,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const res = await api.login(email.trim(), password);
      if (res.success && res.user) {
        if (res.user.role !== 'SYSTEM_ADMIN') {
          throw new Error('Access denied. This account does not possess System SuperAdmin clearance.');
        }
        onSuccess(res.user);
      } else {
        throw new Error('Invalid superadmin credentials.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'System authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-3xl max-w-md w-full shadow-2xl border border-slate-800 text-white overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 border-b border-slate-800 space-y-3">
          <button
            onClick={onBackToCustomer}
            className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 font-semibold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Customer Scanner
          </button>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-lg shadow-amber-500/20">
              <Shield className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-md">
                  Root Level Access
                </span>
                <span className="text-[10px] text-slate-400 font-mono">PORT 3000</span>
              </div>
              <h1 className="text-xl font-black tracking-tight text-white mt-0.5">
                System Admin Sign In
              </h1>
            </div>
          </div>

          <p className="text-xs text-slate-300">
            Platform control, database migrations, SQL export, and multi-tenant supermarket oversight.
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-200 text-xs rounded-xl flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSignIn} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                SuperAdmin Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter SuperAdmin email"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Master Security Key / Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter SuperAdmin password"
                  className="w-full pl-9 pr-10 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Simulated 2FA status */}
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                2FA Hardware Session Active
              </span>
              <span className="font-mono text-[10px] text-amber-400">ENCRYPTED</span>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4" />
              {loading ? 'Authenticating System...' : 'Authenticate Platform SuperAdmin'}
            </button>
          </form>



          {/* Switch to Store Admin */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Managing a single supermarket?</span>
            <button
              type="button"
              onClick={onSwitchToStoreAdmin}
              className="font-bold text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1"
            >
              Store Admin Sign In
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
