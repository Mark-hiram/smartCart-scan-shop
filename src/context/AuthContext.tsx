import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Supermarket, Branch } from '../types';

interface SetupStatus {
  isSetupComplete: boolean;
  adminEmail: string | null;
  hasAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  supermarket: Supermarket | null;
  branch: Branch | null;
  token: string | null;
  isLoading: boolean;
  setupStatus: SetupStatus | null;
  checkSetupStatus: () => Promise<SetupStatus | null>;
  login: (identifier: string, pass: string) => Promise<{ success: boolean; error?: string; remainingAttempts?: number; lockedUntil?: number; mustChangePassword?: boolean }>;
  register: (name: string, email: string, phone: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  setupAdmin: (email: string, name?: string, phone?: string) => Promise<{ success: boolean; tempPassword?: string; adminEmail?: string; error?: string }>;
  changeFirstPassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  logout: () => void;
  setBranch: (branch: Branch | null) => void;
  setSupermarket: (sm: Supermarket | null) => void;
  quickLogin: (role: 'owner' | 'staff' | 'shopper') => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as any);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supermarket, setSupermarket] = useState<Supermarket | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('smartcart_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  // Restore saved store from localStorage for shoppers
  useEffect(() => {
    const savedBranch = localStorage.getItem('smartcart_active_branch');
    if (savedBranch) {
      try {
        setBranch(JSON.parse(savedBranch));
      } catch (e) {}
    }
  }, []);

  const handleSetBranch = (b: Branch | null) => {
    setBranch(b);
    if (b) {
      localStorage.setItem('smartcart_active_branch', JSON.stringify(b));
    } else {
      localStorage.removeItem('smartcart_active_branch');
    }
  };

  const checkSetupStatus = async (): Promise<SetupStatus | null> => {
    try {
      const res = await fetch('/api/admin/setup-status');
      if (res.ok) {
        const data: SetupStatus = await res.json();
        setSetupStatus(data);
        return data;
      }
    } catch (e) {
      console.warn('Failed to check admin setup status:', e);
    }
    return null;
  };

  useEffect(() => {
    checkSetupStatus();
  }, []);

  const reloadUser = async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.supermarket) setSupermarket(data.supermarket);
        if (data.branch) setBranch(data.branch);
      } else {
        // Token invalid
        setToken(null);
        setUser(null);
        localStorage.removeItem('smartcart_token');
      }
    } catch (e) {
      console.error('Error fetching user:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    reloadUser();
  }, [token]);

  const login = async (identifier: string, pass: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error,
          remainingAttempts: data.remainingAttempts,
          lockedUntil: data.lockedUntil,
        };
      }
      setToken(data.token);
      localStorage.setItem('smartcart_token', data.token);
      setUser(data.user);
      if (data.supermarket) setSupermarket(data.supermarket);
      if (data.branch) handleSetBranch(data.branch);
      return { success: true, mustChangePassword: data.user.mustChangePassword };
    } catch (e: any) {
      return { success: false, error: e.message || 'Network error' };
    }
  };

  const register = async (name: string, email: string, phone: string, pass: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      setToken(data.token);
      localStorage.setItem('smartcart_token', data.token);
      setUser(data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Network error' };
    }
  };

  const setupAdmin = async (email: string, name?: string, phone?: string) => {
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      await checkSetupStatus();
      return {
        success: true,
        tempPassword: data.tempPassword,
        adminEmail: data.adminEmail,
      };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to initialize administrator' };
    }
  };

  const changeFirstPassword = async (currentPassword: string, newPassword: string) => {
    if (!token) return { success: false, error: 'Unauthorized. Not signed in.' };
    try {
      const res = await fetch('/api/admin/change-first-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      // Update local user state
      if (user) {
        setUser({ ...user, mustChangePassword: false });
      }
      return { success: true, message: data.message };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to change temporary password.' };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setSupermarket(null);
    localStorage.removeItem('smartcart_token');
  };

  // Demo accounts: Note that ALL demo admin accounts have been permanently purged per security policy.
  const quickLogin = async (role: 'owner' | 'staff' | 'shopper') => {
    const creds: Record<string, { id: string; pass: string }> = {
      owner: { id: 'owner@naivas.com', pass: 'Owner123!' },
      staff: { id: 'staff.westlands@naivas.com', pass: 'Staff123!' },
      shopper: { id: 'shopper@gmail.com', pass: 'Shopper123!' },
    };
    const c = creds[role];
    if (c) {
      await login(c.id, c.pass);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        supermarket,
        branch,
        token,
        isLoading,
        setupStatus,
        checkSetupStatus,
        login,
        register,
        setupAdmin,
        changeFirstPassword,
        logout,
        setBranch: handleSetBranch,
        setSupermarket,
        quickLogin,
        reloadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
