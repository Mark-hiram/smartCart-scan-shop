// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Supermarket, Branch } from '../types';

export interface SetupStatus {
  isSetupComplete: boolean;
}

interface AuthContextType {
  user: User | null;
  supermarket: Supermarket | null;
  branch: Branch | null;
  token: string | null;
  isLoading: boolean;
  adminSetupKeyRequired: boolean;
  setupStatus: SetupStatus | null;
  checkSetupStatus: () => Promise<SetupStatus | null>;
  login: (identifier: string, pass: string, portal?: string) => Promise<{ success: boolean; error?: string; remainingAttempts?: number; lockedUntil?: number; mustChangePassword?: boolean }>;
  register: (name: string, email: string, phone: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  setupAdmin: (email: string, name?: string, phone?: string, setupKey?: string, password?: string) => Promise<{ success: boolean; tempPassword?: string; requiresPasswordChange?: boolean; error?: string }>;
  changeFirstPassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  changeRequiredPassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  logout: () => void;
  setBranch: (branch: Branch | null) => void;
  setSupermarket: (sm: Supermarket | null) => void;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as any);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [supermarket, setSupermarket] = useState<Supermarket | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('smartcart_token');
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [adminSetupKeyRequired, setAdminSetupKeyRequired] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  // Restore saved store from localStorage for shoppers
  useEffect(() => {
    try {
      const savedBranch = localStorage.getItem('smartcart_active_branch');
      if (savedBranch) {
        setBranch(JSON.parse(savedBranch));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // Fetch client config (adminSetupKeyRequired status)
  useEffect(() => {
    fetch('/api/auth/config')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.adminSetupKeyRequired === 'boolean') {
          setAdminSetupKeyRequired(data.adminSetupKeyRequired);
        }
      })
      .catch(() => {});
  }, []);

  const handleSetBranch = (b: Branch | null) => {
    setBranch(b);
    try {
      if (b) {
        localStorage.setItem('smartcart_active_branch', JSON.stringify(b));
      } else {
        localStorage.removeItem('smartcart_active_branch');
      }
    } catch {
      // ignore storage errors
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
        try {
          localStorage.removeItem('smartcart_token');
        } catch {
          // ignore storage errors
        }
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

  const login = async (identifier: string, pass: string, portal?: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: pass, portal }),
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
      try {
        localStorage.setItem('smartcart_token', data.token);
      } catch {
        // ignore storage errors
      }
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
      try {
        localStorage.setItem('smartcart_token', data.token);
      } catch {
        // ignore storage errors
      }
      setUser(data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Network error' };
    }
  };

  const setupAdmin = async (email: string, name?: string, phone?: string, setupKey?: string, password?: string) => {
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, phone, setupKey, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      await checkSetupStatus();
      return {
        success: true,
        tempPassword: data.tempPassword,
        requiresPasswordChange: data.requiresPasswordChange,
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

  const changeRequiredPassword = async (currentPassword: string, newPassword: string) => {
    if (!token) return { success: false, error: 'Unauthorized. Not signed in.' };
    try {
      const res = await fetch('/api/auth/change-required-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to update password.' };
      }
      if (data.user) {
        setUser(data.user);
      } else if (user) {
        setUser({ ...user, mustChangePassword: false });
      }
      return { success: true, message: data.message };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to update password.' };
    }
  };

  const logout = () => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setSupermarket(null);
    try {
      localStorage.removeItem('smartcart_token');
    } catch {
      // ignore storage errors
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
        adminSetupKeyRequired,
        setupStatus,
        checkSetupStatus,
        login,
        register,
        setupAdmin,
        changeFirstPassword,
        changeRequiredPassword,
        logout,
        setBranch: handleSetBranch,
        setSupermarket,
        reloadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
