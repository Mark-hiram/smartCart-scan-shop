import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import {
  Supermarket,
  User,
  AuditLog,
  Announcement,
  SupportTicket,
  SupportCategory,
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
} from 'lucide-react';

export const AdminView: React.FC = () => {
  const { token } = useAuth();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<
    'metrics' | 'reports' | 'supermarkets' | 'users' | 'announcements' | 'support' | 'audit'
  >('metrics');

  const [metrics, setMetrics] = useState<any>(null);
  const [reportsData, setReportsData] = useState<any>(null);
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Search & filter
  const [userSearch, setUserSearch] = useState('');
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

  const loadAdminData = async () => {
    try {
      const [mRes, sRes, uRes, aRes, tRes, lRes, rRes] = await Promise.all([
        fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/supermarkets', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/announcements', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/support', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/audit-logs', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/reports', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (mRes.ok) setMetrics(await mRes.json());
      if (sRes.ok) setSupermarkets(await sRes.json());
      if (uRes.ok) setUsers(await uRes.json());
      if (aRes.ok) setAnnouncements(await aRes.json());
      if (tRes.ok) setSupportTickets(await tRes.json());
      if (lRes.ok) setAuditLogs(await lRes.json());
      if (rRes.ok) setReportsData(await rRes.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // Supermarket toggle status (approve / suspend)
  const handleToggleSupermarketStatus = async (sm: Supermarket) => {
    const nextStatus = sm.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/admin/supermarkets/${sm.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
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

  // Admin Reset User Password
  const handleAdminResetPassword = async (u: User) => {
    if (!confirm(`Reset password for ${u.name} to default: "Reset123!"?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword: 'Reset123!' }),
      });
      if (res.ok) {
        alert(`Password for ${u.name} has been reset to "Reset123!"`);
        loadAdminData();
      }
    } catch (e) {}
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

  // Export CSV
  const handleExportReportCsv = (type: 'traffic' | 'products' | 'branches') => {
    window.open(`/api/reports/csv?type=${type}`, '_blank');
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.phone.includes(userSearch) ||
      u.role.includes(userSearch.toLowerCase())
  );

  // Filtered support tickets by Category & Status
  const filteredTickets = supportTickets.filter((tkt) => {
    const matchStatus = ticketStatusFilter === 'all' || tkt.status === ticketStatusFilter;
    const matchCat = ticketCategoryFilter === 'all' || tkt.category === ticketCategoryFilter;
    return matchStatus && matchCat;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Admin Title Banner */}
      <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold">{t.adminPortal}</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Platform governance, cross-chain supervision, user account management, and system broadcasts.
          </p>
        </div>
      </div>

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-x-auto">
        {[
          { id: 'metrics', label: t.platformReports, icon: <BarChart2 className="w-4 h-4" /> },
          { id: 'reports', label: 'Platform Analytics', icon: <TrendingUp className="w-4 h-4" /> },
          { id: 'supermarkets', label: t.allSupermarkets, icon: <Building2 className="w-4 h-4" /> },
          { id: 'users', label: t.allUsers, icon: <Users className="w-4 h-4" /> },
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
                {reportsData.busiestHours.map((item: any) => {
                  const max = Math.max(...reportsData.busiestHours.map((h: any) => h.count), 1);
                  const heightPct = Math.round((item.count / max) * 100);
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
                {reportsData.busiestDays.map((item: any) => {
                  const max = Math.max(...reportsData.busiestDays.map((d: any) => d.count), 1);
                  const heightPct = Math.round((item.count / max) * 100);
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
                        {item.day.slice(0, 3)}
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
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Supermarket Chains
          </h2>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
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
                {supermarkets.map((sm) => (
                  <tr key={sm.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5">
                      <p className="font-bold text-slate-900 dark:text-white">{sm.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{sm.code}</p>
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
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {sm.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
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
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Platform User Accounts ({users.length})
            </h2>

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
                          {u.role}
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
                      <td className="p-3.5 text-right space-x-2">
                        {u.role !== 'admin' ? (
                          <>
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                            >
                              {u.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                            <button
                              onClick={() => handleAdminResetPassword(u)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                            >
                              Reset Pass
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
            <div className="flex items-center gap-2">
              <select
                value={ticketCategoryFilter}
                onChange={(e) => setTicketCategoryFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
              >
                <option value="all">All Categories</option>
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
                <option value="in_progress">{t.statusInProgress}</option>
                <option value="resolved">{t.statusResolved}</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredTickets.map((tkt) => (
              <div
                key={tkt.id}
                className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        tkt.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : tkt.status === 'in_progress'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {tkt.status}
                    </span>
                    <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                      Category: {tkt.category}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {tkt.subject}
                    </h4>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {new Date(tkt.createdAt).toLocaleDateString()}
                  </span>
                </div>

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
                            onClick={() => setReplyTicketId(null)}
                            className="px-3 py-1.5 rounded-lg border text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleReplyTicket(tkt.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                          >
                            Send Resolution
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReplyTicketId(tkt.id)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reply
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
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
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t.broadcastToChains}
            </h3>
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
      )}
    </div>
  );
};
