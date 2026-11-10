import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import {
  Branch,
  User,
  Promotion,
  AuditLog,
  StaffPermissions,
  StaffPreset,
  STAFF_PRESETS,
  Announcement,
} from '../types';
import {
  Store,
  Users,
  Package,
  Tag,
  BarChart3,
  History,
  Plus,
  AlertTriangle,
  Upload,
  Download,
  CheckCircle2,
  Shield,
  Search,
  Megaphone,
  Check,
  Calendar,
  Layers,
  MapPin,
  TrendingUp,
  DollarSign,
  ShoppingCart,
} from 'lucide-react';

export const OwnerView: React.FC = () => {
  const { user, supermarket, token } = useAuth();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<
    'branches' | 'staff' | 'catalogue' | 'promotions' | 'reports' | 'audit'
  >('branches');

  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<User[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [lowStockCount, setLowStockCount] = useState<number>(0);

  // Reports state
  const [reportsData, setReportsData] = useState<any>(null);
  const [reportBranchFilter, setReportBranchFilter] = useState<string>('');
  const [reportDateRange, setReportDateRange] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [reportsLoading, setReportsLoading] = useState(false);

  // Filter/search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  // Modals state
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [editingStaffMember, setEditingStaffMember] = useState<User | null>(null);
  const [showAddPromoModal, setShowAddPromoModal] = useState(false);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [showEditPriceStockModal, setShowEditPriceStockModal] = useState<any>(null);

  // Form states
  const [newBranch, setNewBranch] = useState({ name: '', code: '', address: '', city: 'Nairobi', phone: '', lat: -1.28, lng: 36.82 });
  
  // Staff Form state with Presets
  const [staffPreset, setStaffPreset] = useState<StaffPreset>('cashier');
  const [staffPermissions, setStaffPermissions] = useState<StaffPermissions>(STAFF_PRESETS.cashier);
  const [newStaff, setNewStaff] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    branchId: '',
  });

  const [newPromo, setNewPromo] = useState({
    name: '',
    type: 'percent_off' as any,
    discountPercent: 15,
    fixedPrice: 100,
    bundleQuantity: 3,
    bundlePrice: 450,
    productBarcode: '',
    branchId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
  });

  // CSV Import State
  const [csvContent, setCsvContent] = useState('');
  const [csvErrors, setCsvErrors] = useState<any[]>([]);
  const [csvSuccess, setCsvSuccess] = useState<string | null>(null);

  // Load announcements
  const loadAnnouncements = async () => {
    try {
      const res = await fetch('/api/announcements', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAnnouncements(await res.json());
      }
    } catch (e) {}
  };

  const handleMarkAnnouncementRead = async (id: string) => {
    try {
      const res = await fetch(`/api/announcements/${id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadAnnouncements();
      }
    } catch (e) {}
  };

  // Fetch overview & data
  const loadData = async () => {
    try {
      const res = await fetch('/api/owner/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
        setStaff(data.staff || []);
        setAuditLogs(data.auditLogs || []);
        setLowStockCount(data.lowStockCount || 0);
        if (data.branches?.length > 0 && !selectedBranchId) {
          setSelectedBranchId(data.branches[0].id);
        }
      }

      // Fetch promotions
      const pRes = await fetch('/api/owner/promotions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pRes.ok) {
        setPromotions(await pRes.json());
      }

      loadAnnouncements();
    } catch (e) {
      console.error(e);
    }
  };

  // Load reports with filters
  const loadReports = async () => {
    setReportsLoading(true);
    try {
      let url = `/api/reports?branchId=${reportBranchFilter}`;
      const now = new Date();
      if (reportDateRange === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        url += `&startDate=${start}`;
      } else if (reportDateRange === '7days') {
        const start = new Date(Date.now() - 7 * 86400000).toISOString();
        url += `&startDate=${start}`;
      } else if (reportDateRange === '30days') {
        const start = new Date(Date.now() - 30 * 86400000).toISOString();
        url += `&startDate=${start}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setReportsData(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReportsLoading(false);
    }
  };

  // Load products for catalogue view
  const loadCatalogue = async () => {
    if (!selectedBranchId && branches.length > 0) return;
    const brId = selectedBranchId || branches[0]?.id;
    if (!brId) return;

    try {
      const res = await fetch(`/api/shopper/branch-products/${brId}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'catalogue' && selectedBranchId) {
      loadCatalogue();
    }
  }, [activeTab, selectedBranchId]);

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReports();
    }
  }, [activeTab, reportBranchFilter, reportDateRange]);

  // Handle Preset selection
  const handlePresetSelect = (preset: StaffPreset) => {
    setStaffPreset(preset);
    if (preset !== 'custom') {
      setStaffPermissions({ ...STAFF_PRESETS[preset] });
    }
  };

  const handlePermissionToggle = (key: keyof StaffPermissions) => {
    setStaffPreset('custom');
    setStaffPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Create Branch Handler
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/owner/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newBranch),
      });
      if (res.ok) {
        setShowAddBranchModal(false);
        setNewBranch({ name: '', code: '', address: '', city: 'Nairobi', phone: '', lat: -1.28, lng: 36.82 });
        loadData();
      }
    } catch (e) {}
  };

  // Create Staff Handler with Presets & Permissions
  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...newStaff,
          permissions: staffPermissions,
        }),
      });
      if (res.ok) {
        setShowAddStaffModal(false);
        setNewStaff({
          name: '',
          email: '',
          phone: '',
          password: '',
          branchId: '',
        });
        setStaffPreset('cashier');
        setStaffPermissions(STAFF_PRESETS.cashier);
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create staff');
      }
    } catch (e) {}
  };

  // Update Existing Staff Permissions
  const handleUpdateStaffPermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaffMember) return;
    try {
      const res = await fetch(`/api/owner/staff/${editingStaffMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          permissions: staffPermissions,
        }),
      });
      if (res.ok) {
        setEditingStaffMember(null);
        loadData();
      }
    } catch (e) {}
  };

  // Toggle Staff Suspension
  const handleToggleStaffStatus = async (staffMember: User) => {
    const nextStatus = staffMember.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await fetch(`/api/owner/staff/${staffMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) loadData();
    } catch (e) {}
  };

  // Save Branch Product Override (Price, Stock & Aisle/Shelf)
  const handleSavePriceStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditPriceStockModal) return;
    try {
      const res = await fetch('/api/owner/branch-product-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branchId: selectedBranchId,
          productId: showEditPriceStockModal.id,
          priceOverride: showEditPriceStockModal.newPrice,
          stock: showEditPriceStockModal.newStock,
          lowStockThresholdOverride: showEditPriceStockModal.newThreshold,
          aisleOverride: showEditPriceStockModal.newAisle,
          shelfOverride: showEditPriceStockModal.newShelf,
        }),
      });
      if (res.ok) {
        setShowEditPriceStockModal(null);
        loadCatalogue();
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || 'Permission denied');
      }
    } catch (e) {}
  };

  // Export Catalogue CSV
  const handleExportCsv = () => {
    window.open(`/api/owner/products/csv-export?branchId=${selectedBranchId}`, '_blank');
  };

  // Export Reports CSV
  const handleExportReportCsv = (type: 'traffic' | 'products' | 'branches') => {
    let url = `/api/reports/csv?type=${type}&branchId=${reportBranchFilter}`;
    if (reportDateRange === 'today') {
      const start = new Date(new Date().setHours(0,0,0,0)).toISOString();
      url += `&startDate=${start}`;
    } else if (reportDateRange === '7days') {
      const start = new Date(Date.now() - 7 * 86400000).toISOString();
      url += `&startDate=${start}`;
    } else if (reportDateRange === '30days') {
      const start = new Date(Date.now() - 30 * 86400000).toISOString();
      url += `&startDate=${start}`;
    }
    window.open(url, '_blank');
  };

  // Import CSV Handler with discrete aisle/shelf
  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setCsvErrors([]);
    setCsvSuccess(null);
    try {
      const res = await fetch('/api/owner/products/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csvText: csvContent, branchId: selectedBranchId }),
      });
      const data = await res.json();
      if (res.ok) {
        setCsvSuccess(`Successfully processed ${data.totalProcessed} products (${data.createdCount} new, ${data.updatedCount} updated).`);
        loadCatalogue();
        loadData();
      } else {
        if (data.errors) {
          setCsvErrors(data.errors);
        } else {
          alert(data.error || 'Import failed');
        }
      }
    } catch (e: any) {
      alert(e.message || 'Import failed');
    }
  };

  // Create Promotion Handler
  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/owner/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newPromo.name,
          type: newPromo.type,
          discountPercent: newPromo.discountPercent,
          fixedPrice: newPromo.fixedPrice,
          bundleQuantity: newPromo.bundleQuantity,
          bundlePrice: newPromo.bundlePrice,
          productBarcodes: [newPromo.productBarcode.trim()],
          branchId: newPromo.branchId || null,
          startDate: new Date(newPromo.startDate).toISOString(),
          endDate: new Date(newPromo.endDate).toISOString(),
        }),
      });
      if (res.ok) {
        setShowAddPromoModal(false);
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || 'Error creating promo');
      }
    } catch (e) {}
  };

  // Filter catalogue
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode.includes(searchTerm) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Supermarket Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 text-white shadow-xl">
        <div>
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
            {t.chainOverview}
          </span>
          <h1 className="text-2xl font-black mt-0.5">
            {supermarket?.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {branches.length} Branches · {staff.length} Staff Accounts · {products.length} Registered Products
          </p>
        </div>

        {/* Low Stock Badge */}
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-300">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-xs font-bold leading-tight">
                {lowStockCount} Low-Stock Warning{lowStockCount === 1 ? '' : 's'}
              </p>
              <p className="text-[10px] text-amber-200/80">Inventory below branch threshold</p>
            </div>
          </div>
        )}
      </div>

      {/* Admin Announcements for Chain Owner */}
      {announcements.length > 0 && (
        <div className="space-y-3">
          {announcements.map((ann) => {
            const isRead = ann.readByUserIds?.includes(user?.id || '');
            return (
              <div
                key={ann.id}
                className={`p-4 rounded-2xl border transition flex items-start justify-between gap-4 ${
                  isRead
                    ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-80'
                    : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 shadow-xs'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Megaphone className={`w-5 h-5 shrink-0 mt-0.5 ${isRead ? 'text-slate-400' : 'text-emerald-600'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {ann.title}
                      </h4>
                      {ann.priority === 'urgent' && (
                        <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-rose-100 text-rose-700">
                          Urgent
                        </span>
                      )}
                      {ann.expiryDate && (
                        <span className="text-[10px] text-slate-400">
                          (Expires: {new Date(ann.expiryDate).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {ann.message}
                    </p>
                  </div>
                </div>

                {!isRead && (
                  <button
                    onClick={() => handleMarkAnnouncementRead(ann.id)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-emerald-600 text-xs font-semibold border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t.markAsRead}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-x-auto">
        {[
          { id: 'branches', label: t.branches, icon: <Store className="w-4 h-4" /> },
          { id: 'staff', label: t.staffManagement, icon: <Users className="w-4 h-4" /> },
          { id: 'catalogue', label: t.catalogue, icon: <Package className="w-4 h-4" /> },
          { id: 'promotions', label: t.promotions, icon: <Tag className="w-4 h-4" /> },
          { id: 'reports', label: t.reports, icon: <BarChart3 className="w-4 h-4" /> },
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

      {/* 1. BRANCHES TAB */}
      {activeTab === 'branches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Chain Branches ({branches.length})
            </h2>
            <button
              onClick={() => setShowAddBranchModal(true)}
              className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addBranch}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div
                key={b.id}
                className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-emerald-600">
                      {b.code}
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                      Active Branch
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                    {b.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {b.address}, {b.city}
                  </p>
                  <p className="text-xs font-mono text-slate-400 mt-1">
                    Phone: {b.phone}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                  <span>GPS: {b.latitude.toFixed(4)}, {b.longitude.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. STAFF TAB: PRESETS & 7 PERMISSION TOGGLES */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Branch Staff Accounts &amp; Presets (Phase 2)
              </h2>
              <p className="text-xs text-slate-500">
                Staff accounts are strictly tied to one branch and enforced on backend APIs.
              </p>
            </div>
            <button
              onClick={() => {
                setStaffPreset('cashier');
                setStaffPermissions(STAFF_PRESETS.cashier);
                setShowAddStaffModal(true);
              }}
              className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addStaff}</span>
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3.5">Name / Email</th>
                    <th className="p-3.5">Assigned Branch</th>
                    <th className="p-3.5">Active Permissions (7 Levels)</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {staff.map((s) => {
                    const staffBranch = branches.find((b) => b.id === s.branchId);
                    const p = s.permissions || {
                      viewStock: false,
                      editStock: false,
                      viewPrices: false,
                      editPrices: false,
                      managePromotions: false,
                      verifyCarts: true,
                      viewReports: false,
                    };
                    return (
                      <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3.5">
                          <p className="font-bold text-slate-900 dark:text-white">{s.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{s.email}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{s.phone}</p>
                        </td>
                        <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                          {staffBranch?.name || 'Unassigned'}
                        </td>
                        <td className="p-3.5">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <span className={p.viewStock ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permViewStock}
                            </span>
                            <span className={p.editStock ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permEditStock}
                            </span>
                            <span className={p.viewPrices ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permViewPrices}
                            </span>
                            <span className={p.editPrices ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permEditPrices}
                            </span>
                            <span className={p.managePromotions ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permManagePromotions}
                            </span>
                            <span className={p.verifyCarts ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permVerifyCarts}
                            </span>
                            <span className={p.viewReports ? 'text-emerald-600 font-medium' : 'text-slate-400 line-through'}>
                              ✓ {t.permViewReports}
                            </span>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              s.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-right space-x-1.5">
                          <button
                            onClick={() => {
                              setEditingStaffMember(s);
                              setStaffPermissions(p);
                              setStaffPreset('custom');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Permissions
                          </button>
                          <button
                            onClick={() => handleToggleStaffStatus(s)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {s.status === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. CATALOGUE TAB & AISLE / SHELF LOCATIONS */}
      {activeTab === 'catalogue' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.catalogue}
              </h2>
              <p className="text-xs text-slate-500">
                Products shared across chain. Each branch can override price, stock, and aisle/shelf location.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCsv}
                className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 hover:bg-slate-50 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.exportCsv}</span>
              </button>
              <button
                onClick={() => {
                  setShowCsvImportModal(true);
                  setCsvErrors([]);
                  setCsvSuccess(null);
                }}
                className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t.importCsv}</span>
              </button>
            </div>
          </div>

          {/* Filter Bar: Branch selection + Search */}
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  Branch: {b.name}
                </option>
              ))}
            </select>

            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search products by barcode, name or category..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-emerald-500"
              />
            </div>
          </div>

          {/* Catalogue Table with discrete Aisle and Shelf */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="p-3.5">Barcode / Product</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">{t.aisleShelfLocation}</th>
                    <th className="p-3.5">Base Price</th>
                    <th className="p-3.5">Branch Price</th>
                    <th className="p-3.5">Branch Stock</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredProducts.map((p) => {
                    const isOverridden = p.branchPrice !== p.basePrice;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3.5">
                          <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                            {p.barcode} ({p.barcodeFormat})
                          </p>
                        </td>
                        <td className="p-3.5 text-slate-600 dark:text-slate-300">
                          {p.category}
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                              Aisle {p.aisle || '—'}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                              Shelf {p.shelf || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3.5 font-mono text-slate-500 tabular-nums">
                          KES {p.basePrice}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`font-mono font-bold tabular-nums ${
                              isOverridden ? 'text-amber-600' : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            KES {p.effectivePrice}
                          </span>
                          {isOverridden && (
                            <span className="block text-[10px] text-amber-600 font-semibold">
                              (Branch Override)
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`font-mono font-bold tabular-nums flex items-center gap-1 ${
                              p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                            }`}
                          >
                            {p.isLowStock && <AlertTriangle className="w-3.5 h-3.5" />}
                            {p.stock} units
                          </span>
                          {p.isLowStock && (
                            <span className="text-[10px] text-amber-600 font-semibold">
                              Low Threshold ({p.lowStockThreshold})
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() =>
                              setShowEditPriceStockModal({
                                ...p,
                                newPrice: p.branchPrice,
                                newStock: p.stock,
                                newThreshold: p.lowStockThreshold,
                                newAisle: p.aisle,
                                newShelf: p.shelf,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-xs font-semibold text-slate-700 dark:text-slate-200 transition"
                          >
                            Adjust
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. PROMOTIONS TAB */}
      {activeTab === 'promotions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.promotions}
              </h2>
              <p className="text-xs text-slate-500">
                Configure offers for all branches or a single branch. Applied in shopper carts automatically.
              </p>
            </div>
            <button
              onClick={() => setShowAddPromoModal(true)}
              className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addPromotion}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {promotions.map((pr) => {
              const promoBranch = branches.find((b) => b.id === pr.branchId);
              return (
                <div
                  key={pr.id}
                  className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full">
                        {pr.type === 'percent_off'
                          ? `${pr.discountPercent}% OFF`
                          : pr.type === 'bundle'
                          ? `${pr.bundleQuantity} for KES ${pr.bundlePrice}`
                          : `Fixed KES ${pr.fixedPrice}`}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          pr.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {pr.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-2">
                      {pr.name}
                    </h3>

                    <div className="text-xs text-slate-500 mt-2 space-y-1">
                      <p>Branch: <strong>{promoBranch ? promoBranch.name : 'All Chain Branches'}</strong></p>
                      <p>Product Barcodes: <span className="font-mono">{pr.productBarcodes.join(', ')}</span></p>
                      <p className="text-[11px] text-slate-400">
                        Valid: {new Date(pr.startDate).toLocaleDateString()} – {new Date(pr.endDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button
                      onClick={async () => {
                        await fetch(`/api/owner/promotions/${pr.id}/toggle`, {
                          method: 'PUT',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        loadData();
                      }}
                      className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                    >
                      {pr.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. REPORTS TAB (PHASE 2 COMPREHENSIVE SUITE) */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.reports} (Phase 2 Analytics)
              </h2>
              <p className="text-xs text-slate-500">
                Hourly/daily traffic trends, top scanned products, and branch comparison tables.
              </p>
            </div>

            {/* Filter Bar: Branch + Date Range */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={reportBranchFilter}
                onChange={(e) => setReportBranchFilter(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
              >
                <option value="">All Chain Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              <select
                value={reportDateRange}
                onChange={(e) => setReportDateRange(e.target.value as any)}
                className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium"
              >
                <option value="all">{t.allTime}</option>
                <option value="today">{t.today}</option>
                <option value="7days">{t.last7Days}</option>
                <option value="30days">{t.last30Days}</option>
              </select>
            </div>
          </div>

          {reportsLoading && (
            <div className="p-8 text-center text-xs text-slate-400">Loading analytics...</div>
          )}

          {reportsData && (
            <>
              {/* Metric KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center gap-2 text-slate-500 text-xs">
                    <ShoppingCart className="w-4 h-4 text-emerald-600" />
                    <span>{t.totalCompletedCarts}</span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {reportsData.totals?.completedCarts || 0}
                  </p>
                </div>

                <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center gap-2 text-slate-500 text-xs">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    <span>{t.revenueLabel}</span>
                  </div>
                  <p className="text-2xl font-black text-emerald-600 mt-1 tabular-nums">
                    KES {(reportsData.totals?.totalRevenue || 0).toLocaleString()}
                  </p>
                </div>

                <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center gap-2 text-slate-500 text-xs">
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>{t.avgCartSize}</span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    {reportsData.totals?.avgCartSize || 0} <span className="text-xs text-slate-400 font-normal">items</span>
                  </p>
                </div>

                <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                  <div className="flex items-center gap-2 text-slate-500 text-xs">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    <span>{t.avgCartValue}</span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                    KES {(reportsData.totals?.avgCartValue || 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Busiest Hours & Days Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Busiest Hours Histogram */}
                <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                      {t.bsyHours} (0:00 – 23:00)
                    </h3>
                    <button
                      onClick={() => handleExportReportCsv('traffic')}
                      className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      <span>CSV</span>
                    </button>
                  </div>
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

                {/* 2. Busiest Days of Week */}
                <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                      {t.bsyDays}
                    </h3>
                    <button
                      onClick={() => handleExportReportCsv('traffic')}
                      className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      <span>CSV</span>
                    </button>
                  </div>
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

              {/* 3. Top Scanned Products Table */}
              <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t.mostScanned}
                  </h3>
                  <button
                    onClick={() => handleExportReportCsv('products')}
                    className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 hover:underline"
                  >
                    <Download className="w-3 h-3" />
                    <span>{t.exportReportCsv}</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                      <tr>
                        <th className="p-2.5">Product Name</th>
                        <th className="p-2.5">Barcode</th>
                        <th className="p-2.5">Total Scans</th>
                        <th className="p-2.5">Units Purchased</th>
                        <th className="p-2.5 text-right">Revenue Generated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportsData.topProducts.map((p: any) => (
                        <tr key={p.barcode} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-2.5 font-bold text-slate-900 dark:text-white">{p.name}</td>
                          <td className="p-2.5 font-mono text-slate-400">{p.barcode}</td>
                          <td className="p-2.5 font-mono tabular-nums">{p.scanCount} scans</td>
                          <td className="p-2.5 font-mono tabular-nums">{p.quantityPurchased} units</td>
                          <td className="p-2.5 text-right font-mono font-bold text-emerald-600 tabular-nums">
                            KES {p.revenue.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 4. Branch Comparison Table */}
              <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t.branchComparison}
                  </h3>
                  <button
                    onClick={() => handleExportReportCsv('branches')}
                    className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 hover:underline"
                  >
                    <Download className="w-3 h-3" />
                    <span>{t.exportReportCsv}</span>
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                      <tr>
                        <th className="p-3">Branch</th>
                        <th className="p-3">Completed Carts</th>
                        <th className="p-3">Items Scanned</th>
                        <th className="p-3">Total Revenue</th>
                        <th className="p-3">Avg Basket Size</th>
                        <th className="p-3">Avg Basket Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportsData.branchStats.map((bs: any) => (
                        <tr key={bs.branchId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-3 font-bold text-slate-900 dark:text-white">{bs.branchName}</td>
                          <td className="p-3 font-mono tabular-nums">{bs.completedCarts}</td>
                          <td className="p-3 font-mono tabular-nums">{bs.totalItemsScanned}</td>
                          <td className="p-3 font-mono font-bold text-emerald-600 tabular-nums">
                            KES {bs.revenue.toLocaleString()}
                          </td>
                          <td className="p-3 font-mono tabular-nums">{bs.avgCartSize} items</td>
                          <td className="p-3 font-mono tabular-nums">
                            KES {bs.avgCartValue.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 6. AUDIT LOG TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.auditLog}
          </h2>
          <p className="text-xs text-slate-500">
            Immutable log recording who changed prices, stock levels, promotions, permissions, and staff accounts.
          </p>

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

      {/* Modal: Add Branch */}
      {showAddBranchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.addBranch}</h3>
            <form onSubmit={handleCreateBranch} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">Branch Name</label>
                <input
                  type="text"
                  required
                  value={newBranch.name}
                  onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
                  placeholder="e.g. Karen Hub Branch"
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">Branch Code</label>
                  <input
                    type="text"
                    required
                    value={newBranch.code}
                    onChange={(e) => setNewBranch({ ...newBranch, code: e.target.value })}
                    placeholder="e.g. KRN"
                    className="w-full h-10 px-3 rounded-xl border text-xs uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Phone</label>
                  <input
                    type="tel"
                    required
                    value={newBranch.phone}
                    onChange={(e) => setNewBranch({ ...newBranch, phone: e.target.value })}
                    placeholder="+254711..."
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1">Address / Street</label>
                <input
                  type="text"
                  required
                  value={newBranch.address}
                  onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })}
                  placeholder="e.g. Dagoretti Road"
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddBranchModal(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Create Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Staff with Presets & 7 Permissions */}
      {showAddStaffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.addStaff}</h3>
            <form onSubmit={handleCreateStaff} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">{t.fullName}</label>
                <input
                  type="text"
                  required
                  value={newStaff.name}
                  onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={newStaff.email}
                    onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Phone</label>
                  <input
                    type="tel"
                    required
                    value={newStaff.phone}
                    onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">Temporary Password</label>
                  <input
                    type="password"
                    required
                    value={newStaff.password}
                    onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Assigned Branch</label>
                  <select
                    required
                    value={newStaff.branchId}
                    onChange={(e) => setNewStaff({ ...newStaff, branchId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  >
                    <option value="">Select branch...</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ready-made Presets */}
              <div>
                <label className="text-xs font-bold block mb-1">{t.presetSelect}</label>
                <select
                  value={staffPreset}
                  onChange={(e) => handlePresetSelect(e.target.value as StaffPreset)}
                  className="w-full h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs font-semibold text-emerald-950 dark:text-emerald-200"
                >
                  <option value="cashier">{t.presetCashier}</option>
                  <option value="stock_clerk">{t.presetStockClerk}</option>
                  <option value="branch_manager">{t.presetBranchManager}</option>
                  <option value="custom">{t.presetCustom}</option>
                </select>
              </div>

              {/* 7 Granular Permissions */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold block">{t.permissions}:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewStock}
                      onChange={() => handlePermissionToggle('viewStock')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewStock}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.editStock}
                      onChange={() => handlePermissionToggle('editStock')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permEditStock}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewPrices}
                      onChange={() => handlePermissionToggle('viewPrices')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewPrices}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.editPrices}
                      onChange={() => handlePermissionToggle('editPrices')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permEditPrices}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.managePromotions}
                      onChange={() => handlePermissionToggle('managePromotions')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permManagePromotions}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.verifyCarts}
                      onChange={() => handlePermissionToggle('verifyCarts')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permVerifyCarts}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewReports}
                      onChange={() => handlePermissionToggle('viewReports')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewReports}</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddStaffModal(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Create Staff Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Existing Staff Permissions */}
      {editingStaffMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Edit Permissions: {editingStaffMember.name}
            </h3>

            <form onSubmit={handleUpdateStaffPermissions} className="space-y-3">
              <div>
                <label className="text-xs font-bold block mb-1">{t.presetSelect}</label>
                <select
                  value={staffPreset}
                  onChange={(e) => handlePresetSelect(e.target.value as StaffPreset)}
                  className="w-full h-10 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs font-semibold text-emerald-950 dark:text-emerald-200"
                >
                  <option value="cashier">{t.presetCashier}</option>
                  <option value="stock_clerk">{t.presetStockClerk}</option>
                  <option value="branch_manager">{t.presetBranchManager}</option>
                  <option value="custom">{t.presetCustom}</option>
                </select>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewStock}
                      onChange={() => handlePermissionToggle('viewStock')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewStock}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.editStock}
                      onChange={() => handlePermissionToggle('editStock')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permEditStock}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewPrices}
                      onChange={() => handlePermissionToggle('viewPrices')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewPrices}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.editPrices}
                      onChange={() => handlePermissionToggle('editPrices')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permEditPrices}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.managePromotions}
                      onChange={() => handlePermissionToggle('managePromotions')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permManagePromotions}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.verifyCarts}
                      onChange={() => handlePermissionToggle('verifyCarts')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permVerifyCarts}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={staffPermissions.viewReports}
                      onChange={() => handlePermissionToggle('viewReports')}
                      className="rounded text-emerald-600"
                    />
                    <span>{t.permViewReports}</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStaffMember(null)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Save Permissions
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adjust Branch Price, Stock, & Aisle/Shelf */}
      {showEditPriceStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Adjust Branch Price, Stock &amp; Location
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {showEditPriceStockModal.name}
              </p>
            </div>

            <form onSubmit={handleSavePriceStock} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">
                  Branch Price Override (KES)
                </label>
                <input
                  type="number"
                  value={showEditPriceStockModal.newPrice ?? ''}
                  onChange={(e) =>
                    setShowEditPriceStockModal({
                      ...showEditPriceStockModal,
                      newPrice: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  placeholder={`Base price: KES ${showEditPriceStockModal.basePrice}`}
                  className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Branch Stock Level
                  </label>
                  <input
                    type="number"
                    value={showEditPriceStockModal.newStock}
                    onChange={(e) =>
                      setShowEditPriceStockModal({
                        ...showEditPriceStockModal,
                        newStock: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Low Stock Alert
                  </label>
                  <input
                    type="number"
                    value={showEditPriceStockModal.newThreshold}
                    onChange={(e) =>
                      setShowEditPriceStockModal({
                        ...showEditPriceStockModal,
                        newThreshold: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              </div>

              {/* Discrete Aisle & Shelf */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    {t.aisle}
                  </label>
                  <input
                    type="text"
                    value={showEditPriceStockModal.newAisle || ''}
                    onChange={(e) =>
                      setShowEditPriceStockModal({
                        ...showEditPriceStockModal,
                        newAisle: e.target.value,
                      })
                    }
                    placeholder="e.g. 3"
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">
                    {t.shelf}
                  </label>
                  <input
                    type="text"
                    value={showEditPriceStockModal.newShelf || ''}
                    onChange={(e) =>
                      setShowEditPriceStockModal({
                        ...showEditPriceStockModal,
                        newShelf: e.target.value,
                      })
                    }
                    placeholder="e.g. B"
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditPriceStockModal(null)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: CSV Import with Aisle and Shelf Columns */}
      {showCsvImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t.importCsv} (with Aisle &amp; Shelf)
            </h3>
            <p className="text-xs text-slate-500">
              Paste your catalogue CSV. Header format: <code className="font-mono text-emerald-600">barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold</code>
            </p>

            {csvSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{csvSuccess}</span>
              </div>
            )}

            {/* Row by row validation errors list */}
            {csvErrors.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-rose-50 text-rose-800 text-xs space-y-2 border border-rose-200">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Validation Errors Found in CSV ({csvErrors.length} errors):</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-rose-200/60 font-mono text-[11px]">
                  {csvErrors.map((err, idx) => (
                    <div key={idx} className="py-1">
                      <strong>Row {err.row}</strong>: {err.message} {err.barcode && `(Barcode: ${err.barcode})`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleImportCsv} className="space-y-3">
              <textarea
                rows={8}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder={`barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold\n6161101234566,"Brookside Fresh Whole Milk 500ml",Dairy,65,1,A,60,45,10`}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs focus:outline-emerald-500"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCsvImportModal(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  Validate &amp; Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Promotion */}
      {showAddPromoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.addPromotion}</h3>
            <form onSubmit={handleCreatePromo} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">Offer Title</label>
                <input
                  type="text"
                  required
                  value={newPromo.name}
                  onChange={(e) => setNewPromo({ ...newPromo, name: e.target.value })}
                  placeholder="e.g. 15% Off Cooking Oil Weekend"
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold block mb-1">{t.promoType}</label>
                <select
                  value={newPromo.type}
                  onChange={(e) => setNewPromo({ ...newPromo, type: e.target.value as any })}
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                >
                  <option value="percent_off">{t.percentOff}</option>
                  <option value="fixed_price">{t.fixedSalePrice}</option>
                  <option value="bundle">{t.buyMorePayLess}</option>
                </select>
              </div>

              {newPromo.type === 'percent_off' && (
                <div>
                  <label className="text-xs font-semibold block mb-1">Discount Percentage (%)</label>
                  <input
                    type="number"
                    value={newPromo.discountPercent}
                    onChange={(e) => setNewPromo({ ...newPromo, discountPercent: parseFloat(e.target.value) })}
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              )}

              {newPromo.type === 'fixed_price' && (
                <div>
                  <label className="text-xs font-semibold block mb-1">Special Fixed Price (KES)</label>
                  <input
                    type="number"
                    value={newPromo.fixedPrice}
                    onChange={(e) => setNewPromo({ ...newPromo, fixedPrice: parseFloat(e.target.value) })}
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              )}

              {newPromo.type === 'bundle' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold block mb-1">Bundle Qty</label>
                    <input
                      type="number"
                      value={newPromo.bundleQuantity}
                      onChange={(e) => setNewPromo({ ...newPromo, bundleQuantity: parseInt(e.target.value, 10) })}
                      className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold block mb-1">Bundle Total (KES)</label>
                    <input
                      type="number"
                      value={newPromo.bundlePrice}
                      onChange={(e) => setNewPromo({ ...newPromo, bundlePrice: parseFloat(e.target.value) })}
                      className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold block mb-1">Target Product Barcode</label>
                <input
                  type="text"
                  required
                  value={newPromo.productBarcode}
                  onChange={(e) => setNewPromo({ ...newPromo, productBarcode: e.target.value })}
                  placeholder="e.g. 6161101234566"
                  className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold block mb-1">Branch Scope</label>
                <select
                  value={newPromo.branchId}
                  onChange={(e) => setNewPromo({ ...newPromo, branchId: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                >
                  <option value="">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newPromo.startDate}
                    onChange={(e) => setNewPromo({ ...newPromo, startDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">End Date</label>
                  <input
                    type="date"
                    value={newPromo.endDate}
                    onChange={(e) => setNewPromo({ ...newPromo, endDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPromoModal(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Save Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
