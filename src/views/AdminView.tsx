// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PortalBackgroundImage } from '../components/PortalBackgroundImage';
import {
  Supermarket,
  User,
  AuditLog,
  Announcement,
  SupportTicket,
  SupportCategory,
  LoyaltySettings,
  RewardItem,
  RewardRedemptionOrder,
  RedemptionStatus,
} from '../types';
import {
  ShieldCheck,
  Building2,
  Users,
  BarChart2,
  Bell,
  MessageSquare,
  History,
  Lock,
  Plus,
  AlertCircle,
  CheckCircle,
  Search,
  Filter,
  Download,
  Calendar,
  Layers,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  KeyRound,
  Copy,
  Check,
  Eye,
  EyeOff,
  Gift,
  Sliders,
  Trash2,
  Edit3,
  X,
} from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export const AdminView: React.FC = () => {
  const { token, user, reloadUser } = useAuth();
  const { t, language } = useTranslation();

  const [activeTab, setActiveTab] = useState<
    'metrics' | 'reports' | 'supermarkets' | 'users' | 'rewards' | 'loyalty_settings' | 'announcements' | 'support' | 'audit'
  >('metrics');

  const [metrics, setMetrics] = useState<any>(null);
  const [reportsData, setReportsData] = useState<any>(null);
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Loyalty Rewards, Redemptions & Settings state
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [redemptionOrders, setRedemptionOrders] = useState<RewardRedemptionOrder[]>([]);
  const [loyaltyTotals, setLoyaltyTotals] = useState<{
    pointsIssued: number;
    pointsRedeemed: number;
    pointsOutstanding: number;
    pointsExpired: number;
    fulfilledCountThisMonth: number;
    fulfilledCostThisMonthKes: number;
  }>({
    pointsIssued: 0,
    pointsRedeemed: 0,
    pointsOutstanding: 0,
    pointsExpired: 0,
    fulfilledCountThisMonth: 0,
    fulfilledCostThisMonthKes: 0,
  });
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [loyaltyActionError, setLoyaltyActionError] = useState<string | null>(null);
  const [loyaltyActionSuccess, setLoyaltyActionSuccess] = useState<string | null>(null);

  // Reject/Cancel reason modal
  const [rejectModalOrder, setRejectModalOrder] = useState<RewardRedemptionOrder | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');

  // Create / Edit Reward modal
  const [rewardEditor, setRewardEditor] = useState<{
    id?: string;
    name: string;
    nameSw: string;
    description: string;
    descriptionSw: string;
    imageUrl: string;
    pointsCost: number;
    unitCostKes: number;
    colorsText: string;
    sizesText: string;
    stockBySize: Record<string, number>;
    status: 'active' | 'hidden';
  } | null>(null);

  // Loyalty Settings form
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Search & filter
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'shopper' | 'shops'>('all');
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>('all');
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState<string>('all');

  // Modals / forms
  const [showAncModal, setShowAncModal] = useState(false);
  const [newAnc, setNewAnc] = useState({
    title: '',
    message: '',
    targetSmId: '',
    priority: 'normal' as any,
    expiryDate: '',
  });
  const [replyTicketId, setReplyTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [generatedResetPasswords, setGeneratedResetPasswords] = useState<
    Record<string, { tempPassword: string; expiresAt: number }>
  >({});
  const [copiedTicketPassId, setCopiedTicketPassId] = useState<string | null>(null);
  const [rejectingTicketId, setRejectingTicketId] = useState<string | null>(null);
  const [ticketRejectReason, setTicketRejectReason] = useState('');
  const [supportActionError, setSupportActionError] = useState<Record<string, string>>({});
  const [isSupportActionLoading, setIsSupportActionLoading] = useState<string | null>(null);

  // Admin reset password modal for shoppers & shops
  const [resetTarget, setResetTarget] = useState<{
    mode: 'user' | 'shop';
    id: string;
    name: string;
    subtitle: string;
    roleLabel: string;
  } | null>(null);
  const [resetCustomPassword, setResetCustomPassword] = useState('');
  const [resetShowPassword, setResetShowPassword] = useState(false);
  const [resetGeneratedPassword, setResetGeneratedPassword] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [copiedResetPass, setCopiedResetPass] = useState(false);

  // Admin account credentials modal state
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [acctEmail, setAcctEmail] = useState(user?.email || '');
  const [acctName, setAcctName] = useState(user?.name || '');
  const [acctCurrentPassword, setAcctCurrentPassword] = useState('');
  const [acctNewPassword, setAcctNewPassword] = useState('');
  const [acctConfirmPassword, setAcctConfirmPassword] = useState('');
  const [acctStatus, setAcctStatus] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isUpdatingAcct, setIsUpdatingAcct] = useState(false);

  useBodyScrollLock(
    showAncModal ||
      showAccountModal ||
      Boolean(resetTarget) ||
      Boolean(rejectModalOrder) ||
      Boolean(rewardEditor)
  );

  const loadAdminData = async () => {
    if (!token) return;
    try {
      const [mRes, sRes, uRes, aRes, tRes, lRes, rRes, rewRes, ordRes, setRes] = await Promise.all([
        fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/supermarkets', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/announcements', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/support', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/audit-logs', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/reports', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/rewards', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/redemptions', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/loyalty/settings', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (mRes.ok) setMetrics(await mRes.json());
      if (sRes.ok) {
        const d = await sRes.json();
        if (Array.isArray(d)) setSupermarkets(d);
      }
      if (uRes.ok) {
        const d = await uRes.json();
        if (Array.isArray(d)) setUsers(d);
      }
      if (aRes.ok) {
        const d = await aRes.json();
        if (Array.isArray(d)) setAnnouncements(d);
      }
      if (tRes.ok) {
        const d = await tRes.json();
        if (Array.isArray(d)) setSupportTickets(d);
      }
      if (lRes.ok) {
        const d = await lRes.json();
        if (Array.isArray(d)) setAuditLogs(d);
      }
      if (rRes.ok) setReportsData(await rRes.json());
      if (rewRes.ok) {
        const d = await rewRes.json();
        if (Array.isArray(d)) setRewards(d);
      }
      if (ordRes.ok) {
        const d = await ordRes.json();
        if (Array.isArray(d?.orders)) setRedemptionOrders(d.orders);
        if (d?.totals) setLoyaltyTotals(d.totals);
      }
      if (setRes.ok) {
        setLoyaltySettings(await setRes.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [token]);

  // Supermarket toggle/set status (approve / reject / suspend)
  const handleToggleSupermarketStatus = async (
    sm: Supermarket,
    explicitStatus?: 'active' | 'suspended' | 'rejected'
  ) => {
    const nextStatus = explicitStatus || (sm.status === 'active' ? 'suspended' : 'active');
    try {
      const res = await fetch(`/api/admin/supermarkets/${sm.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus, language }),
      });
      if (res.ok) loadAdminData();
    } catch (e) {}
  };

  // User toggle status (activate / suspend)
  const handleToggleUserStatus = async (u: User) => {
    const nextStatus = u.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/admin/users/${u.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) loadAdminData();
    } catch (e) {}
  };

  // Open Admin Reset Password Modal for a shopper or shop user/chain
  const openResetPasswordModal = (target: {
    mode: 'user' | 'shop';
    id: string;
    name: string;
    subtitle: string;
    roleLabel: string;
  }) => {
    setResetTarget(target);
    setResetCustomPassword('');
    setResetShowPassword(false);
    setResetGeneratedPassword(null);
    setResetStatus(null);
    setCopiedResetPass(false);
  };

  const handleSubmitAdminResetPassword = async (autoGenerate: boolean) => {
    if (!resetTarget || !token) return;
    setResetStatus(null);
    setResetGeneratedPassword(null);

    if (!autoGenerate && resetCustomPassword.trim().length < 8) {
      setResetStatus({
        type: 'error',
        text: 'Password must be at least 8 characters long, or choose Generate Temporary Password.',
      });
      return;
    }

    setIsResettingPassword(true);
    try {
      const endpoint =
        resetTarget.mode === 'shop'
          ? `/api/admin/supermarkets/${resetTarget.id}/reset-password`
          : `/api/admin/users/${resetTarget.id}/reset-password`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          autoGenerate ? { language } : { newPassword: resetCustomPassword.trim(), language }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        setResetStatus({ type: 'error', text: data.error || 'Failed to reset password.' });
      } else {
        setResetStatus({ type: 'success', text: data.message || 'Password reset successfully.' });
        if (data.generatedPassword) {
          setResetGeneratedPassword(data.generatedPassword);
        }
        setResetCustomPassword('');
        await loadAdminData();
      }
    } catch (e: any) {
      setResetStatus({ type: 'error', text: e?.message || 'Network error resetting password.' });
    } finally {
      setIsResettingPassword(false);
    }
  };

  // Create Announcement with Expiry Date (Phase 2)
  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: newAnc.title,
          message: newAnc.message,
          targetSupermarketId: newAnc.targetSmId || null,
          priority: newAnc.priority,
          expiryDate: newAnc.expiryDate ? new Date(newAnc.expiryDate).toISOString() : null,
        }),
      });
      if (res.ok) {
        setShowAncModal(false);
        setNewAnc({ title: '', message: '', targetSmId: '', priority: 'normal', expiryDate: '' });
        loadAdminData();
      }
    } catch (e) {}
  };

  // Reply to support ticket (Phase 2)
  const handleReplyTicket = async (ticketId: string) => {
    if (!replyText.trim()) return;
    try {
      const res = await fetch(`/api/support/${ticketId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reply: replyText.trim(), status: 'resolved' }),
      });
      if (res.ok) {
        setReplyTicketId(null);
        setReplyText('');
        loadAdminData();
      }
    } catch (e) {}
  };

  // Admin: update identity check checklist on a password reset request
  const handleToggleIdentityCheck = async (
    ticket: SupportTicket,
    field: 'phoneConfirmed' | 'lastPurchaseOrPointsConfirmed'
  ) => {
    if (!token || !ticket.passwordResetDetails) return;
    const current = ticket.passwordResetDetails.identityChecked || {
      phoneConfirmed: false,
      lastPurchaseOrPointsConfirmed: false,
    };
    const payload = {
      phoneConfirmed: field === 'phoneConfirmed' ? !current.phoneConfirmed : Boolean(current.phoneConfirmed),
      lastPurchaseOrPointsConfirmed:
        field === 'lastPurchaseOrPointsConfirmed'
          ? !current.lastPurchaseOrPointsConfirmed
          : Boolean(current.lastPurchaseOrPointsConfirmed),
    };
    setSupportActionError((prev) => ({ ...prev, [ticket.id]: '' }));
    setIsSupportActionLoading(ticket.id);
    try {
      const res = await fetch(`/api/support/${ticket.id}/verify-identity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportActionError((prev) => ({ ...prev, [ticket.id]: data.error || 'Failed to update identity check.' }));
      } else {
        await loadAdminData();
      }
    } catch (e: any) {
      setSupportActionError((prev) => ({ ...prev, [ticket.id]: e?.message || 'Network error.' }));
    } finally {
      setIsSupportActionLoading(null);
    }
  };

  // Admin: generate one-time 24h temporary password for verified password reset request
  const handleGenerateResetTempPassword = async (ticket: SupportTicket) => {
    if (!token || !ticket.passwordResetDetails) return;
    const checked = ticket.passwordResetDetails.identityChecked;
    setSupportActionError((prev) => ({ ...prev, [ticket.id]: '' }));
    setIsSupportActionLoading(ticket.id);
    try {
      const res = await fetch(`/api/support/${ticket.id}/generate-temp-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          phoneConfirmed: Boolean(checked?.phoneConfirmed),
          lastPurchaseOrPointsConfirmed: Boolean(checked?.lastPurchaseOrPointsConfirmed),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportActionError((prev) => ({
          ...prev,
          [ticket.id]: data.error || 'Could not generate temporary password.',
        }));
      } else {
        setGeneratedResetPasswords((prev) => ({
          ...prev,
          [ticket.id]: {
            tempPassword: data.tempPassword,
            expiresAt: data.expiresAt,
          },
        }));
        setCopiedTicketPassId(null);
        await loadAdminData();
      }
    } catch (e: any) {
      setSupportActionError((prev) => ({ ...prev, [ticket.id]: e?.message || 'Network error.' }));
    } finally {
      setIsSupportActionLoading(null);
    }
  };

  // Admin: reject password reset request with a reason
  const handleRejectResetRequest = async (ticketId: string) => {
    if (!token) return;
    if (ticketRejectReason.trim().length < 3) {
      setSupportActionError((prev) => ({
        ...prev,
        [ticketId]: 'Please enter a rejection reason (at least 3 characters).',
      }));
      return;
    }
    setSupportActionError((prev) => ({ ...prev, [ticketId]: '' }));
    setIsSupportActionLoading(ticketId);
    try {
      const res = await fetch(`/api/support/${ticketId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: ticketRejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportActionError((prev) => ({ ...prev, [ticketId]: data.error || 'Could not reject request.' }));
      } else {
        setRejectingTicketId(null);
        setTicketRejectReason('');
        await loadAdminData();
      }
    } catch (e: any) {
      setSupportActionError((prev) => ({ ...prev, [ticketId]: e?.message || 'Network error.' }));
    } finally {
      setIsSupportActionLoading(null);
    }
  };

  // Export CSV with Bearer auth (no window.open)
  const handleExportReportCsv = async (type: 'traffic' | 'products' | 'branches') => {
    if (!token) return;
    try {
      const res = await fetch(`/api/reports/csv?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartcart_${type}_report.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('CSV export failed:', e);
    }
  };

  // Export Loyalty Metric / Orders CSV with Bearer auth
  const handleExportLoyaltyCsv = async (
    type: 'issued' | 'redeemed' | 'outstanding' | 'fulfilled_cost' | 'orders'
  ) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/redemptions/export-csv?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loyalty_${type}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Loyalty CSV export failed:', e);
    }
  };

  const handleUpdateOrderStatus = async (
    orderId: string,
    status: RedemptionStatus,
    reason?: string
  ) => {
    if (!token) return;
    setLoyaltyActionError(null);
    setLoyaltyActionSuccess(null);
    try {
      const res = await fetch(`/api/admin/redemptions/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoyaltyActionError(data.error || 'Could not update redemption status.');
      } else {
        setRejectModalOrder(null);
        setRejectReasonInput('');
        setLoyaltyActionSuccess(`Order ${data.order?.referenceCode} updated to ${status}.`);
        await loadAdminData();
      }
    } catch (e: any) {
      setLoyaltyActionError(e?.message || 'Network error.');
    }
  };

  const handleSaveReward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewardEditor || !token) return;
    setLoyaltyActionError(null);
    setLoyaltyActionSuccess(null);

    const parsedSizes = rewardEditor.sizesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedColors = rewardEditor.colorsText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const payload = {
      name: rewardEditor.name.trim(),
      nameSw: rewardEditor.nameSw.trim() || undefined,
      description: rewardEditor.description.trim(),
      descriptionSw: rewardEditor.descriptionSw.trim() || undefined,
      imageUrl: rewardEditor.imageUrl.trim() || '/images/rewards/smartcart-tshirt.svg',
      pointsCost: Number(rewardEditor.pointsCost),
      unitCostKes: Number(rewardEditor.unitCostKes),
      colors: parsedColors.length > 0 ? parsedColors : ['Emerald Green'],
      sizes: parsedSizes.length > 0 ? parsedSizes : ['One Size'],
      stockBySize: rewardEditor.stockBySize,
      status: rewardEditor.status,
    };

    try {
      const url = rewardEditor.id
        ? `/api/admin/rewards/${rewardEditor.id}`
        : '/api/admin/rewards';
      const method = rewardEditor.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoyaltyActionError(data.error || 'Failed to save reward.');
      } else {
        setRewardEditor(null);
        setLoyaltyActionSuccess(`Reward "${data.name}" saved.`);
        await loadAdminData();
      }
    } catch (err: any) {
      setLoyaltyActionError(err?.message || 'Network error saving reward.');
    }
  };

  const handleToggleRewardVisibility = async (rew: RewardItem) => {
    if (!token) return;
    const nextStatus = rew.status === 'active' ? 'hidden' : 'active';
    const res = await fetch(`/api/admin/rewards/${rew.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) await loadAdminData();
  };

  const handleDeleteReward = async (rew: RewardItem) => {
    if (!token) return;
    setLoyaltyActionError(null);
    const res = await fetch(`/api/admin/rewards/${rew.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setLoyaltyActionError(data.error || 'Could not delete reward.');
    } else {
      setLoyaltyActionSuccess(`Reward "${rew.name}" deleted.`);
      await loadAdminData();
    }
  };

  const handleSaveLoyaltySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loyaltySettings || !token) return;
    setIsSavingSettings(true);
    setLoyaltyActionError(null);
    setLoyaltyActionSuccess(null);
    try {
      const res = await fetch('/api/admin/loyalty/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(loyaltySettings),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoyaltyActionError(data.error || 'Failed to save loyalty settings.');
      } else {
        setLoyaltySettings(data);
        setLoyaltyActionSuccess('Loyalty points rules and caps updated.');
      }
    } catch (err: any) {
      setLoyaltyActionError(err?.message || 'Network error.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const pendingSupermarketCount = supermarkets.filter((sm) => sm.status === 'pending').length;
  const requestedOrdersCount = redemptionOrders.filter((o) => o.status === 'requested').length;

  const filteredRedemptionOrders = redemptionOrders.filter((o) => {
    if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
    const q = orderSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      o.referenceCode.toLowerCase().includes(q) ||
      o.shopperName.toLowerCase().includes(q) ||
      o.shopperEmail.toLowerCase().includes(q) ||
      o.rewardName.toLowerCase().includes(q) ||
      o.contactPhone.toLowerCase().includes(q)
    );
  });

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.phone.includes(userSearch) ||
      u.role.includes(userSearch.toLowerCase());

    if (!matchesSearch) return false;
    if (userRoleFilter === 'shopper') return u.role === 'shopper';
    if (userRoleFilter === 'shops') return u.role === 'owner' || u.role === 'staff';
    return true;
  });

  // Filtered support tickets by Category & Status
  const filteredTickets = supportTickets.filter((tkt) => {
    const matchStatus = ticketStatusFilter === 'all' || tkt.status === ticketStatusFilter;
    const matchCat = ticketCategoryFilter === 'all' || tkt.category === ticketCategoryFilter;
    return matchStatus && matchCat;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Admin Title Banner */}
      <div className="portal-banner-surface relative overflow-hidden p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PortalBackgroundImage portal="admin" variant="banner" priority />
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-200" />
            <h1 className="text-xl font-bold text-white">{t.adminPortal}</h1>
          </div>
          <p className="text-xs text-indigo-100/90 mt-1">
            Platform governance, cross-chain supervision, user account management, and system broadcasts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setAcctEmail(user?.email || '');
            setAcctName(user?.name || '');
            setAcctCurrentPassword('');
            setAcctNewPassword('');
            setAcctConfirmPassword('');
            setAcctStatus(null);
            setShowAccountModal(true);
          }}
          className="relative z-10 self-start sm:self-auto px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white flex items-center gap-2 transition"
        >
          <KeyRound className="w-4 h-4 text-emerald-400" />
          <span>Admin Credentials</span>
        </button>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-x-auto">
        {[
          { id: 'metrics', label: t.platformReports, icon: <BarChart2 className="w-4 h-4" /> },
          { id: 'reports', label: 'Platform Analytics', icon: <TrendingUp className="w-4 h-4" /> },
          { id: 'supermarkets', label: t.allSupermarkets, icon: <Building2 className="w-4 h-4" /> },
          { id: 'users', label: t.allUsers, icon: <Users className="w-4 h-4" /> },
          { id: 'rewards', label: t.adminTabRewards, icon: <Gift className="w-4 h-4" /> },
          { id: 'loyalty_settings', label: t.adminTabLoyaltySettings, icon: <Sliders className="w-4 h-4" /> },
          { id: 'announcements', label: t.announcements, icon: <Bell className="w-4 h-4" /> },
          { id: 'support', label: t.supportInbox, icon: <MessageSquare className="w-4 h-4" /> },
          { id: 'audit', label: t.auditLog, icon: <History className="w-4 h-4" /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition active:scale-95 ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.id === 'supermarkets' && pendingSupermarketCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black leading-none">
                {pendingSupermarketCount}
              </span>
            )}
            {tab.id === 'rewards' && requestedOrdersCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black leading-none">
                {requestedOrdersCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 1. METRICS TAB */}
      {activeTab === 'metrics' && metrics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.totalChains}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {metrics.totalChains}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.totalBranches}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {metrics.totalBranches}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.totalShoppers}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {metrics.totalShoppers}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.totalCarts}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {metrics.totalCarts}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs col-span-2 lg:col-span-1">
              <span className="text-xs text-slate-500">{t.totalScans}</span>
              <p className="text-2xl font-black text-emerald-600 mt-1 tabular-nums">
                {metrics.totalItemsScanned}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. PLATFORM-WIDE REPORTS (PHASE 2) */}
      {activeTab === 'reports' && reportsData && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Platform-Wide Analytics &amp; Performance
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportReportCsv('traffic')}
                className="py-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 text-slate-700 dark:text-slate-300"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Traffic</span>
              </button>
              <button
                onClick={() => handleExportReportCsv('products')}
                className="py-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 text-slate-700 dark:text-slate-300"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Products</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Hourly chart */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {t.bsyHours} (All Supermarkets)
              </h3>
              <div className="h-40 flex items-end gap-1 pt-4">
                {(reportsData.busiestHours || (reportsData.hourCounts || []).map((count: number, hour: number) => ({ hour, count }))).map((item: any, _idx: number, arr: any[]) => {
                  const max = Math.max(...arr.map((h: any) => h.count || 0), 1);
                  const heightPct = Math.round(((item.count || 0) / max) * 100);
                  return (
                    <div key={item.hour} className="flex-1 flex flex-col items-center gap-1 group">
                      <div
                        className="w-full bg-emerald-500 rounded-t-sm transition-all group-hover:bg-emerald-400 min-h-[4px]"
                        style={{ height: `${Math.max(4, heightPct)}%` }}
                        title={`${item.hour}:00 — ${item.count} carts`}
                      />
                      {item.hour % 3 === 0 && (
                        <span className="text-[9px] text-slate-400 font-mono">
                          {item.hour}h
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Days of week chart */}
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {t.bsyDays} (All Supermarkets)
              </h3>
              <div className="h-40 flex items-end gap-3 pt-4">
                {(reportsData.busiestDays || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day: string, idx: number) => ({ day, count: (reportsData.dayCounts || [])[idx] || 0 }))).map((item: any, _idx: number, arr: any[]) => {
                  const max = Math.max(...arr.map((d: any) => d.count || 0), 1);
                  const heightPct = Math.round(((item.count || 0) / max) * 100);
                  return (
                    <div key={item.day} className="flex-1 flex flex-col items-center gap-1 group">
                      <span className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                        {item.count}
                      </span>
                      <div
                        className="w-full bg-teal-500 rounded-t-md transition-all group-hover:bg-teal-400 min-h-[6px]"
                        style={{ height: `${Math.max(6, heightPct)}%` }}
                      />
                      <span className="text-[10px] text-slate-500 font-semibold truncate">
                        {String(item.day || '').slice(0, 3)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. SUPERMARKETS TAB */}
      {activeTab === 'supermarkets' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Supermarket Chains ({supermarkets.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                Only the System Administrator can approve newly registered shops or reset shop owner passwords.
              </p>
            </div>
            {pendingSupermarketCount > 0 && (
              <span className="px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold">
                {pendingSupermarketCount} Pending Approval
              </span>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="p-3.5">Chain Name / Code</th>
                  <th className="p-3.5">Corporate Email</th>
                  <th className="p-3.5">Phone</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {supermarkets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-xs text-slate-400">
                      No shops registered yet.
                    </td>
                  </tr>
                )}
                {supermarkets.map((sm) => (
                  <tr key={sm.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5">
                      <p className="font-bold text-slate-900 dark:text-white">{sm.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{sm.code}</p>
                      {sm.city && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {sm.city}{sm.firstBranchName ? ` · 1st Branch: ${sm.firstBranchName}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                      {sm.contactEmail}
                    </td>
                    <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                      {sm.contactPhone}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          sm.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : sm.status === 'pending'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {sm.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap space-x-1.5">
                      {sm.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleToggleSupermarketStatus(sm, 'active')}
                            className="px-3 py-1 rounded-lg text-xs font-semibold border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition"
                          >
                            {t.approveSupermarket}
                          </button>
                          <button
                            onClick={() => handleToggleSupermarketStatus(sm, 'rejected')}
                            className="px-3 py-1 rounded-lg text-xs font-semibold border border-rose-300 text-rose-600 hover:bg-rose-50 transition"
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleToggleSupermarketStatus(sm)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                            sm.status === 'active'
                              ? 'border-rose-300 text-rose-600 hover:bg-rose-50'
                              : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          {sm.status === 'active' ? t.suspendSupermarket : t.approveSupermarket}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          openResetPasswordModal({
                            mode: 'shop',
                            id: sm.id,
                            name: sm.name,
                            subtitle: sm.contactEmail,
                            roleLabel: 'Shop Owner',
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition inline-flex items-center gap-1"
                      >
                        <KeyRound className="w-3 h-3 text-emerald-600" />
                        <span>Reset Pass</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. USERS MANAGEMENT TAB */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mr-2">
                Platform User Accounts ({filteredUsers.length})
              </h2>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'shopper', label: 'Shoppers' },
                  { id: 'shops', label: 'Shops & Staff' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setUserRoleFilter(f.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                      userRoleFilter === f.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search user by name, email, phone..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-emerald-500"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3.5">Name / Email</th>
                    <th className="p-3.5">Phone</th>
                    <th className="p-3.5">Role</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5">
                        <p className="font-bold text-slate-900 dark:text-white">{u.name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{u.email}</p>
                      </td>
                      <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                        {u.phone}
                      </td>
                      <td className="p-3.5">
                        <span className="font-semibold capitalize text-slate-800 dark:text-slate-200">
                          {u.role === 'owner' ? 'Shop Owner' : u.role}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            u.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                        {u.role !== 'admin' ? (
                          <>
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                            >
                              {u.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                openResetPasswordModal({
                                  mode: 'user',
                                  id: u.id,
                                  name: u.name,
                                  subtitle: u.email,
                                  roleLabel:
                                    u.role === 'owner'
                                      ? 'Shop Owner'
                                      : u.role === 'staff'
                                      ? 'Shop Staff'
                                      : 'Shopper',
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 inline-flex items-center gap-1"
                            >
                              <KeyRound className="w-3 h-3 text-emerald-600" />
                              <span>Reset Pass</span>
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-bold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            Permanent Single Admin
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4B. REWARDS CATALOGUE & REDEMPTION ORDERS QUEUE */}
      {activeTab === 'rewards' && (
        <div className="space-y-6">
          {loyaltyActionError && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loyaltyActionError}</span>
              </div>
              <button type="button" onClick={() => setLoyaltyActionError(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {loyaltyActionSuccess && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2 font-semibold">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{loyaltyActionSuccess}</span>
              </div>
              <button type="button" onClick={() => setLoyaltyActionSuccess(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Loyalty KPIs with individual CSV export buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs text-slate-500">{t.adminLoyaltyIssued}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                {loyaltyTotals.pointsIssued.toLocaleString()} pts
              </p>
              <button
                type="button"
                onClick={() => handleExportLoyaltyCsv('issued')}
                className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs text-slate-500">{t.adminLoyaltyRedeemed}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                {loyaltyTotals.pointsRedeemed.toLocaleString()} pts
              </p>
              <button
                type="button"
                onClick={() => handleExportLoyaltyCsv('redeemed')}
                className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs text-slate-500">{t.adminLoyaltyOutstanding}</span>
              <p className="text-2xl font-black text-emerald-600 tabular-nums">
                {loyaltyTotals.pointsOutstanding.toLocaleString()} pts
              </p>
              <button
                type="button"
                onClick={() => handleExportLoyaltyCsv('outstanding')}
                className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs text-slate-500">{t.adminLoyaltyFulfilledCost}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                KES {loyaltyTotals.fulfilledCostThisMonthKes.toLocaleString()}
              </p>
              <button
                type="button"
                onClick={() => handleExportLoyaltyCsv('fulfilled_cost')}
                className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Rewards Orders Queue */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Rewards Orders Queue ({filteredRedemptionOrders.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={orderSearchQuery}
                  onChange={(e) => setOrderSearchQuery(e.target.value)}
                  placeholder="Search Ref RW-..., shopper, phone..."
                  className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
                <select
                  value={orderStatusFilter}
                  onChange={(e) => setOrderStatusFilter(e.target.value)}
                  className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
                >
                  <option value="all">All Statuses</option>
                  <option value="requested">Requested</option>
                  <option value="approved">Approved</option>
                  <option value="ready">Ready for collection</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleExportLoyaltyCsv('orders')}
                  className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 text-slate-700 dark:text-slate-300"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Orders CSV</span>
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3.5">Ref / Date</th>
                    <th className="p-3.5">Shopper</th>
                    <th className="p-3.5">Reward &amp; Size</th>
                    <th className="p-3.5">Fulfillment</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredRedemptionOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-xs text-slate-400">
                        No redemption orders matching filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRedemptionOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3.5">
                          <p className="font-mono font-bold text-slate-900 dark:text-white">
                            {ord.referenceCode}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {new Date(ord.createdAt).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="p-3.5">
                          <p className="font-bold text-slate-900 dark:text-white">{ord.shopperName}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{ord.contactPhone}</p>
                          <p className="text-[10px] text-slate-400">{ord.shopperEmail}</p>
                        </td>
                        <td className="p-3.5">
                          <p className="font-bold text-slate-900 dark:text-white">{ord.rewardName}</p>
                          <p className="text-[11px] text-slate-500 tabular-nums">
                            {ord.size} · {ord.color} · {ord.pointsCost.toLocaleString()} pts (KES {ord.unitCostKes})
                          </p>
                        </td>
                        <td className="p-3.5 text-[11px] text-slate-600 dark:text-slate-300 max-w-[200px]">
                          {ord.fulfillmentMethod === 'collection'
                            ? `Collect: ${ord.branchName || 'Branch'}`
                            : `Deliver: ${ord.deliveryAddress || ''}`}
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {ord.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap space-x-1.5">
                          {ord.status === 'requested' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(ord.id, 'approved')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700"
                            >
                              Approve
                            </button>
                          )}
                          {ord.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateOrderStatus(
                                  ord.id,
                                  ord.fulfillmentMethod === 'collection' ? 'ready' : 'dispatched'
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700"
                            >
                              {ord.fulfillmentMethod === 'collection' ? 'Mark Ready' : 'Mark Dispatched'}
                            </button>
                          )}
                          {(ord.status === 'approved' || ord.status === 'ready' || ord.status === 'dispatched') && (
                            <button
                              type="button"
                              onClick={() => handleUpdateOrderStatus(ord.id, 'completed')}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-[11px] font-semibold"
                            >
                              Complete
                            </button>
                          )}
                          {ord.status !== 'completed' && ord.status !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRejectModalOrder(ord);
                                setRejectReasonInput('');
                              }}
                              className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-600 text-[11px] font-semibold hover:bg-rose-50"
                            >
                              Reject / Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rewards Catalogue Manager */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Merchandise Rewards Catalogue ({rewards.length})
                </h2>
                <p className="text-[11px] text-slate-500">
                  Managed strictly by the System Administrator. Supermarket owners cannot alter catalogue items.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setRewardEditor({
                    name: '',
                    nameSw: '',
                    description: '',
                    descriptionSw: '',
                    imageUrl: '/images/rewards/smartcart-tshirt.svg',
                    pointsCost: 150,
                    unitCostKes: 900,
                    colorsText: 'Emerald Green, White',
                    sizesText: 'S, M, L, XL, XXL',
                    stockBySize: { S: 10, M: 15, L: 15, XL: 10, XXL: 5 },
                    status: 'active',
                  })
                }
                className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Reward</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {rewards.map((rew) => (
                <div
                  key={rew.id}
                  className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={rew.imageUrl}
                        alt={rew.name}
                        width={56}
                        height={56}
                        className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 object-contain p-1 border border-slate-100 dark:border-slate-700 shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {rew.name}
                        </h3>
                        <p className="text-xs font-mono font-bold text-emerald-600 tabular-nums">
                          {rew.pointsCost.toLocaleString()} pts · Cost KES {rew.unitCostKes.toLocaleString()}
                        </p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            rew.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {rew.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Stock:{' '}
                    {rew.sizes.map((sz) => `${sz}: ${rew.stockBySize?.[sz] ?? 0}`).join(' · ')}
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setRewardEditor({
                          id: rew.id,
                          name: rew.name,
                          nameSw: rew.nameSw || '',
                          description: rew.description,
                          descriptionSw: rew.descriptionSw || '',
                          imageUrl: rew.imageUrl,
                          pointsCost: rew.pointsCost,
                          unitCostKes: rew.unitCostKes,
                          colorsText: rew.colors.join(', '),
                          sizesText: rew.sizes.join(', '),
                          stockBySize: { ...rew.stockBySize },
                          status: rew.status,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleRewardVisibility(rew)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold"
                    >
                      {rew.status === 'active' ? 'Hide' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteReward(rew)}
                      className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4C. LOYALTY RULES & CAPS SETTINGS */}
      {activeTab === 'loyalty_settings' && loyaltySettings && (
        <div className="space-y-4">
          {loyaltyActionError && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-xs text-rose-700">
              {loyaltyActionError}
            </div>
          )}
          {loyaltyActionSuccess && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs text-emerald-700 font-semibold">
              {loyaltyActionSuccess}
            </div>
          )}

          <form
            onSubmit={handleSaveLoyaltySettings}
            className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Loyalty Earning Rules, Anti-Fraud Caps &amp; Tiers
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Points are calculated server-side only when a cashier verifies a shopper trolley at the till.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">1 Point Earned Per (KES)</label>
                <input
                  type="number"
                  min={1}
                  value={loyaltySettings.pointsPerKesAmount}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      pointsPerKesAmount: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Fixed Bonus Per Verified Cart (pts)</label>
                <input
                  type="number"
                  min={0}
                  value={loyaltySettings.bonusPointsPerVerifiedCart}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      bonusPointsPerVerifiedCart: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Minimum Cart Value to Earn (KES)</label>
                <input
                  type="number"
                  min={0}
                  value={loyaltySettings.minCartValueKes}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      minCartValueKes: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Daily Maximum Points Per Shopper</label>
                <input
                  type="number"
                  min={0}
                  value={loyaltySettings.dailyCapPoints}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      dailyCapPoints: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Monthly Maximum Points Per Shopper</label>
                <input
                  type="number"
                  min={0}
                  value={loyaltySettings.monthlyCapPoints}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      monthlyCapPoints: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Max Open Redemptions Per Shopper</label>
                <input
                  type="number"
                  min={1}
                  value={loyaltySettings.maxOpenRedemptionsPerShopper}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      maxOpenRedemptionsPerShopper: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Silver Tier Threshold (Lifetime pts)</label>
                <input
                  type="number"
                  min={10}
                  value={loyaltySettings.tierThresholds.silver}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      tierThresholds: {
                        ...loyaltySettings.tierThresholds,
                        silver: Math.max(10, parseInt(e.target.value, 10) || 10),
                      },
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Gold Tier Threshold (Lifetime pts)</label>
                <input
                  type="number"
                  min={20}
                  value={loyaltySettings.tierThresholds.gold}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      tierThresholds: {
                        ...loyaltySettings.tierThresholds,
                        gold: Math.max(20, parseInt(e.target.value, 10) || 20),
                      },
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold block mb-1 text-[11px]">Bronze Bonus</label>
                  <input
                    type="number"
                    min={0}
                    value={loyaltySettings.tierBonuses.bronze}
                    onChange={(e) =>
                      setLoyaltySettings({
                        ...loyaltySettings,
                        tierBonuses: {
                          ...loyaltySettings.tierBonuses,
                          bronze: Math.max(0, parseInt(e.target.value, 10) || 0),
                        },
                      })
                    }
                    className="w-full h-10 px-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1 text-[11px]">Silver Bonus</label>
                  <input
                    type="number"
                    min={0}
                    value={loyaltySettings.tierBonuses.silver}
                    onChange={(e) =>
                      setLoyaltySettings({
                        ...loyaltySettings,
                        tierBonuses: {
                          ...loyaltySettings.tierBonuses,
                          silver: Math.max(0, parseInt(e.target.value, 10) || 0),
                        },
                      })
                    }
                    className="w-full h-10 px-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1 text-[11px]">Gold Bonus</label>
                  <input
                    type="number"
                    min={0}
                    value={loyaltySettings.tierBonuses.gold}
                    onChange={(e) =>
                      setLoyaltySettings({
                        ...loyaltySettings,
                        tierBonuses: {
                          ...loyaltySettings.tierBonuses,
                          gold: Math.max(0, parseInt(e.target.value, 10) || 0),
                        },
                      })
                    }
                    className="w-full h-10 px-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={loyaltySettings.pointsExpiryEnabled}
                  onChange={(e) =>
                    setLoyaltySettings({
                      ...loyaltySettings,
                      pointsExpiryEnabled: e.target.checked,
                    })
                  }
                  className="rounded text-emerald-600"
                />
                <span>Enable automatic points expiry (default off)</span>
              </label>

              {loyaltySettings.pointsExpiryEnabled && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">Expire unused points after (days):</span>
                  <input
                    type="number"
                    min={1}
                    value={loyaltySettings.pointsExpiryDays}
                    onChange={(e) =>
                      setLoyaltySettings({
                        ...loyaltySettings,
                        pointsExpiryDays: Math.max(1, parseInt(e.target.value, 10) || 365),
                      })
                    }
                    className="w-24 h-9 px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition"
              >
                {isSavingSettings ? 'Saving...' : 'Save Loyalty Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. ANNOUNCEMENTS TAB WITH EXPIRY (PHASE 2) */}
      {activeTab === 'announcements' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              System Announcements
            </h2>
            <button
              onClick={() => setShowAncModal(true)}
              className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t.broadcastToChains}</span>
            </button>
          </div>

          <div className="space-y-3">
            {announcements.map((a) => (
              <div
                key={a.id}
                className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    {a.priority === 'urgent' && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 rounded-full">
                        Urgent
                      </span>
                    )}
                    <span>{a.title}</span>
                  </h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <span>Created: {new Date(a.createdAt).toLocaleDateString()}</span>
                    {a.expiryDate && (
                      <span className="text-amber-600 font-bold">
                        (Expires: {new Date(a.expiryDate).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {a.message}
                </p>
                <p className="text-[11px] text-slate-400">
                  Target: {a.targetSupermarketId ? 'Selected Chain' : 'All Supermarkets & Branches'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. SUPPORT & COMPLAINTS INBOX (PHASE 2 CATEGORIZED & FILTERABLE) */}
      {activeTab === 'support' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.supportInbox}
              </h2>
              <p className="text-xs text-slate-500">
                Shoppers, staff and owners requests categorized with live resolution status.
              </p>
            </div>

            {/* Filter Bar: Status & Category */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={ticketCategoryFilter}
                onChange={(e) => setTicketCategoryFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
              >
                <option value="all">All Categories</option>
                <option value="password_reset">{t.catPasswordReset}</option>
                <option value="scanner">{t.catScanner}</option>
                <option value="pricing">{t.catPricing}</option>
                <option value="stock">{t.catStock}</option>
                <option value="cashier">{t.catCashier}</option>
                <option value="app_issue">{t.catAppIssue}</option>
                <option value="other">{t.catOther}</option>
              </select>

              <select
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="open">{t.statusOpen}</option>
                <option value="verified">{t.statusVerified}</option>
                <option value="completed">{t.statusCompleted}</option>
                <option value="rejected">{t.statusRejected}</option>
                <option value="in_progress">{t.statusInProgress}</option>
                <option value="resolved">{t.statusResolved}</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredTickets.length === 0 && (
              <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                No support requests match the selected filters.
              </div>
            )}

            {filteredTickets.map((tkt) => {
              const resetDetails = tkt.category === 'password_reset' ? tkt.passwordResetDetails : undefined;
              const onceGenerated = generatedResetPasswords[tkt.id];
              const actionErr = supportActionError[tkt.id];
              const phoneChecked = Boolean(resetDetails?.identityChecked?.phoneConfirmed);
              const secondaryChecked = Boolean(resetDetails?.identityChecked?.lastPurchaseOrPointsConfirmed);
              const isResetActionable = tkt.status !== 'completed' && tkt.status !== 'rejected';

              return (
                <div
                  key={tkt.id}
                  className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          tkt.status === 'resolved' || tkt.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : tkt.status === 'verified'
                            ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                            : tkt.status === 'rejected'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            : tkt.status === 'in_progress'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {tkt.status}
                      </span>
                      <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                        {tkt.category === 'password_reset' ? 'Password reset' : `Category: ${tkt.category}`}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {tkt.subject}
                      </h4>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(tkt.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {resetDetails ? (
                    <div className="space-y-3 text-xs">
                      {/* Submitted Request Details */}
                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">Entered Name</span>
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {resetDetails.requestedFullName}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">Entered Email / Phone</span>
                            <span className="font-mono text-slate-800 dark:text-slate-200 break-all">
                              {resetDetails.requestedIdentifier}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase text-slate-400 block">Sign-In Portal</span>
                            <span className="capitalize font-semibold text-slate-800 dark:text-slate-200">
                              {resetDetails.portalRequested}
                            </span>
                          </div>
                        </div>
                        {resetDetails.note && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                            <strong>Note:</strong> {resetDetails.note}
                          </p>
                        )}
                      </div>

                      {/* Admin-Only Account Match + Masked Contacts & Verification Hints */}
                      <div
                        className={`p-3.5 rounded-2xl border space-y-1.5 ${
                          resetDetails.matchedAccount
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800/80'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`text-[11px] font-bold ${
                              resetDetails.matchedAccount
                                ? 'text-emerald-800 dark:text-emerald-300'
                                : 'text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {resetDetails.matchedAccount
                              ? `Matching Account Found (${resetDetails.matchedRole}${
                                  resetDetails.matchedSupermarketName ? ` · ${resetDetails.matchedSupermarketName}` : ''
                                })`
                              : 'No Matching Non-Admin Account Found'}
                          </span>
                          {resetDetails.matchedAccount && (
                            <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                              {resetDetails.maskedEmail || '—'} · {resetDetails.maskedPhone || '—'}
                            </span>
                          )}
                        </div>

                        {resetDetails.matchedAccount && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-4 gap-y-1 pt-1">
                            <span>
                              <strong>Points Balance:</strong> {resetDetails.identityHintPointsBalance ?? 0} pts
                            </span>
                            <span>
                              <strong>Last Purchase:</strong> {resetDetails.identityHintLastPurchase || 'No completed carts'}
                            </span>
                          </div>
                        )}
                      </div>

                      {actionErr && (
                        <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                          {actionErr}
                        </div>
                      )}

                      {/* Generated Once-Only Temporary Password Display */}
                      {onceGenerated && (
                        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-800 space-y-2">
                          <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                            {t.tempPasswordOneTimeWarning}
                          </p>
                          <div className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-sm flex items-center justify-between gap-2">
                            <span className="break-all select-all">{onceGenerated.tempPassword}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(onceGenerated.tempPassword);
                                setCopiedTicketPassId(tkt.id);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-sans font-semibold flex items-center gap-1 shrink-0"
                            >
                              {copiedTicketPassId === tkt.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedTicketPassId === tkt.id ? t.passwordCopied : t.copyPassword}</span>
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                            <span>Expires: {new Date(onceGenerated.expiresAt).toLocaleString()}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setGeneratedResetPasswords((prev) => {
                                  const next = { ...prev };
                                  delete next[tkt.id];
                                  return next;
                                })
                              }
                              className="font-semibold underline hover:text-slate-900 dark:hover:text-white"
                            >
                              Clear from screen
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Identity Verification Checklist + Actions */}
                      {isResetActionable && (
                        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                          <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                            Identity Verification Checklist (complete before generating temporary password):
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={phoneChecked}
                                disabled={!resetDetails.matchedAccount || isSupportActionLoading === tkt.id}
                                onChange={() => handleToggleIdentityCheck(tkt, 'phoneConfirmed')}
                                className="rounded text-emerald-600"
                              />
                              <span>Confirmed phone number on call/message</span>
                            </label>
                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={secondaryChecked}
                                disabled={!resetDetails.matchedAccount || isSupportActionLoading === tkt.id}
                                onChange={() => handleToggleIdentityCheck(tkt, 'lastPurchaseOrPointsConfirmed')}
                                className="rounded text-emerald-600"
                              />
                              <span>Confirmed last purchase or points balance</span>
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {resetDetails.matchedAccount && (
                              <button
                                type="button"
                                disabled={!phoneChecked || !secondaryChecked || isSupportActionLoading === tkt.id}
                                onClick={() => handleGenerateResetTempPassword(tkt)}
                                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-1.5 transition"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                                <span>Generate temporary password</span>
                              </button>
                            )}

                            {rejectingTicketId === tkt.id ? (
                              <div className="w-full space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                <input
                                  type="text"
                                  value={ticketRejectReason}
                                  onChange={(e) => setTicketRejectReason(e.target.value)}
                                  placeholder="Enter reason for rejecting this request..."
                                  className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRejectingTicketId(null);
                                      setTicketRejectReason('');
                                    }}
                                    className="px-3 py-1.5 rounded-lg border text-xs"
                                  >
                                    {t.cancel}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSupportActionLoading === tkt.id}
                                    onClick={() => handleRejectResetRequest(tkt.id)}
                                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                                  >
                                    Confirm Reject
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingTicketId(tkt.id);
                                  setTicketRejectReason('');
                                }}
                                className="px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold"
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {tkt.status === 'completed' && !onceGenerated && (
                        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-300">
                          Temporary password issued by <strong>{resetDetails.resolvedByName || 'Admin'}</strong>
                          {resetDetails.resolvedAt ? ` on ${new Date(resetDetails.resolvedAt).toLocaleString()}` : ''}.
                          {resetDetails.tempPasswordExpiresAt
                            ? ` Valid until ${new Date(resetDetails.tempPasswordExpiresAt).toLocaleString()}.`
                            : ''}
                        </div>
                      )}

                      {tkt.status === 'rejected' && resetDetails.rejectionReason && (
                        <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-900 dark:text-rose-300">
                          <strong>Rejected Reason:</strong> {resetDetails.rejectionReason}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        "{tkt.message}"
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Submitted by {tkt.userName} ({tkt.userEmail} · {tkt.userPhone})
                      </p>

                      {tkt.reply && (
                        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-900 dark:text-emerald-300 border border-emerald-200">
                          <strong>Admin Reply:</strong> {tkt.reply}
                        </div>
                      )}

                      {!tkt.reply && (
                        <div className="pt-2">
                          {replyTicketId === tkt.id ? (
                            <div className="space-y-2">
                              <textarea
                                rows={2}
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Type reply to user..."
                                className="w-full p-2.5 rounded-xl border text-xs"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setReplyTicketId(null)}
                                  className="px-3 py-1.5 rounded-lg border text-xs"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReplyTicket(tkt.id)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                                >
                                  Send Resolution
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setReplyTicketId(tkt.id)}
                              className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Reply
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. AUDIT LOG TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Platform-Wide Audit Trail
          </h2>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 flex items-start justify-between text-xs gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                      {log.action}
                    </span>
                    <span className="text-slate-500">{log.userName} ({log.userRole})</span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mt-1">{log.details}</p>
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Broadcast Announcement with Optional Expiry Date */}
      {showAncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t.broadcastToChains}
              </h3>
              <button
                type="button"
                onClick={() => setShowAncModal(false)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0">
              <form onSubmit={handleCreateAnnouncement} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold block mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={newAnc.title}
                    onChange={(e) => setNewAnc({ ...newAnc, title: e.target.value })}
                    placeholder="e.g. Scheduled Network Maintenance"
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Message</label>
                  <textarea
                    rows={3}
                    required
                    value={newAnc.message}
                    onChange={(e) => setNewAnc({ ...newAnc, message: e.target.value })}
                    placeholder="Enter broadcast message details..."
                    className="w-full p-3 rounded-xl border text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Target Chain</label>
                  <select
                    value={newAnc.targetSmId}
                    onChange={(e) => setNewAnc({ ...newAnc, targetSmId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  >
                    <option value="">All Supermarkets &amp; Branches</option>
                    {supermarkets.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Phase 2: Expiry Date */}
                <div>
                  <label className="text-xs font-semibold block mb-1">{t.announcementExpiry}</label>
                  <input
                    type="date"
                    value={newAnc.expiryDate}
                    onChange={(e) => setNewAnc({ ...newAnc, expiryDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAncModal(false)}
                    className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                  >
                    Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Update Single System Admin Email & Password */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  Single System Admin Credentials
                </h3>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  1 Account Only
                </span>
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  aria-label="Close"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0 space-y-4">

            {acctStatus && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  acctStatus.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {acctStatus.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{acctStatus.text}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAcctStatus(null);
                if (acctNewPassword && acctNewPassword.length < 8) {
                  setAcctStatus({ type: 'error', text: 'New password must be at least 8 characters long.' });
                  return;
                }
                if (acctNewPassword && acctNewPassword !== acctConfirmPassword) {
                  setAcctStatus({ type: 'error', text: 'New passwords do not match.' });
                  return;
                }
                setIsUpdatingAcct(true);
                try {
                  const res = await fetch('/api/admin/account', {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      currentPassword: acctCurrentPassword,
                      newEmail: acctEmail,
                      name: acctName,
                      ...(acctNewPassword ? { newPassword: acctNewPassword } : {}),
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setAcctStatus({ type: 'error', text: data.error || 'Failed to update credentials.' });
                  } else {
                    await reloadUser();
                    await loadAdminData();
                    setAcctCurrentPassword('');
                    setAcctNewPassword('');
                    setAcctConfirmPassword('');
                    setAcctStatus({ type: 'success', text: data.message || 'Credentials updated successfully.' });
                  }
                } catch (err: any) {
                  setAcctStatus({ type: 'error', text: err?.message || 'Network error.' });
                } finally {
                  setIsUpdatingAcct(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-semibold block mb-1">Admin Sign-In Email</label>
                <input
                  type="email"
                  required
                  value={acctEmail}
                  onChange={(e) => setAcctEmail(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={acctName}
                  onChange={(e) => setAcctName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1">Current Password *</label>
                <input
                  type="password"
                  required
                  value={acctCurrentPassword}
                  onChange={(e) => setAcctCurrentPassword(e.target.value)}
                  placeholder="Enter current password to confirm changes"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1">New Password (optional, min 8 chars)</label>
                <input
                  type="password"
                  value={acctNewPassword}
                  onChange={(e) => setAcctNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
              {acctNewPassword && (
                <div>
                  <label className="text-xs font-semibold block mb-1">Confirm New Password *</label>
                  <input
                    type="password"
                    required
                    value={acctConfirmPassword}
                    onChange={(e) => setAcctConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingAcct}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {isUpdatingAcct ? 'Saving...' : 'Save Credentials'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Admin Password Reset Helper for Shoppers & Shops */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    Reset Account Password
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    {resetTarget.name} · {resetTarget.roleLabel} ({resetTarget.subtitle})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0 space-y-4">

            {resetStatus && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  resetStatus.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {resetStatus.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{resetStatus.text}</span>
              </div>
            )}

            {resetGeneratedPassword && (
              <div className="p-3 rounded-2xl bg-slate-900 text-white space-y-2">
                <p className="text-[11px] text-slate-300">
                  One-time generated password (existing sessions revoked &amp; any account lock cleared):
                </p>
                <div className="flex items-center justify-between gap-2 bg-slate-800 px-3 py-2 rounded-xl border border-slate-700">
                  <code className="text-sm font-mono font-bold text-emerald-400 select-all">
                    {resetGeneratedPassword}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(resetGeneratedPassword);
                      setCopiedResetPass(true);
                      setTimeout(() => setCopiedResetPass(false), 2000);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                  >
                    {copiedResetPass ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedResetPass ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">
                  Set Custom Password (min 8 chars)
                </label>
                <div className="relative">
                  <input
                    type={resetShowPassword ? 'text' : 'password'}
                    value={resetCustomPassword}
                    onChange={(e) => setResetCustomPassword(e.target.value)}
                    placeholder="Enter new password for this account..."
                    className="w-full h-10 pl-3 pr-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setResetShowPassword(!resetShowPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    aria-label={resetShowPassword ? 'Hide password' : 'Show password'}
                  >
                    {resetShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={isResettingPassword || resetCustomPassword.trim().length < 8}
                  onClick={() => handleSubmitAdminResetPassword(false)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-bold transition"
                >
                  Set Password
                </button>
                <button
                  type="button"
                  disabled={isResettingPassword}
                  onClick={() => handleSubmitAdminResetPassword(true)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 disabled:opacity-45 text-white text-xs font-bold transition"
                >
                  Generate Temp Password
                </button>
              </div>

              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Close
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reject / Cancel Redemption Order with Reason */}
      {rejectModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Reject / Cancel Order {rejectModalOrder.referenceCode}
              </h3>
              <button
                type="button"
                onClick={() => setRejectModalOrder(null)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0 space-y-4">
              <p className="text-xs text-slate-500">
                Cancelling returns {rejectModalOrder.pointsCost.toLocaleString()} points to{' '}
                <strong>{rejectModalOrder.shopperName}</strong> and restores size stock if previously approved.
              </p>
              <textarea
                rows={3}
                required
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Reason for rejection or cancellation..."
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModalOrder(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  disabled={!rejectReasonInput.trim()}
                  onClick={() =>
                    handleUpdateOrderStatus(
                      rejectModalOrder.id,
                      'cancelled',
                      rejectReasonInput.trim()
                    )
                  }
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-45 text-white text-xs font-bold"
                >
                  Confirm Rejection &amp; Refund Points
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Reward Item */}
      {rewardEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {rewardEditor.id ? 'Edit Reward Item' : 'Add New Reward Item'}
              </h3>
              <button
                type="button"
                onClick={() => setRewardEditor(null)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0">

            <form onSubmit={handleSaveReward} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Reward Name (EN) *</label>
                  <input
                    type="text"
                    required
                    value={rewardEditor.name}
                    onChange={(e) => setRewardEditor({ ...rewardEditor, name: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Reward Name (SW)</label>
                  <input
                    type="text"
                    value={rewardEditor.nameSw}
                    onChange={(e) => setRewardEditor({ ...rewardEditor, nameSw: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Description (EN)</label>
                <textarea
                  rows={2}
                  value={rewardEditor.description}
                  onChange={(e) => setRewardEditor({ ...rewardEditor, description: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Description (SW)</label>
                <textarea
                  rows={2}
                  value={rewardEditor.descriptionSw}
                  onChange={(e) => setRewardEditor({ ...rewardEditor, descriptionSw: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Points Cost *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={rewardEditor.pointsCost}
                    onChange={(e) =>
                      setRewardEditor({
                        ...rewardEditor,
                        pointsCost: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Unit Cost (KES)</label>
                  <input
                    type="number"
                    min={0}
                    value={rewardEditor.unitCostKes}
                    onChange={(e) =>
                      setRewardEditor({
                        ...rewardEditor,
                        unitCostKes: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Status</label>
                  <select
                    value={rewardEditor.status}
                    onChange={(e) =>
                      setRewardEditor({
                        ...rewardEditor,
                        status: e.target.value as 'active' | 'hidden',
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="active">Active</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Image Path / URL</label>
                <input
                  type="text"
                  value={rewardEditor.imageUrl}
                  onChange={(e) => setRewardEditor({ ...rewardEditor, imageUrl: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Colours (comma-separated)</label>
                  <input
                    type="text"
                    value={rewardEditor.colorsText}
                    onChange={(e) => setRewardEditor({ ...rewardEditor, colorsText: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Sizes (comma-separated)</label>
                  <input
                    type="text"
                    value={rewardEditor.sizesText}
                    onChange={(e) => setRewardEditor({ ...rewardEditor, sizesText: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1.5">Stock Count Per Size</label>
                <div className="flex flex-wrap gap-2">
                  {rewardEditor.sizesText
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((sz) => (
                      <div key={sz} className="w-20">
                        <span className="text-[10px] font-bold text-slate-500 block mb-0.5">{sz}</span>
                        <input
                          type="number"
                          min={0}
                          value={rewardEditor.stockBySize[sz] ?? 0}
                          onChange={(e) =>
                            setRewardEditor({
                              ...rewardEditor,
                              stockBySize: {
                                ...rewardEditor.stockBySize,
                                [sz]: Math.max(0, parseInt(e.target.value, 10) || 0),
                              },
                            })
                          }
                          className="w-full h-9 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                        />
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRewardEditor(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  Save Reward
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
