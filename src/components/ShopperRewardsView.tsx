// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect, useMemo } from 'react';
import {
  Award,
  Gift,
  Sparkles,
  CheckCircle2,
  Clock,
  Truck,
  Store,
  AlertCircle,
  X,
  ShieldAlert,
  ReceiptText,
  Ban,
} from 'lucide-react';
import {
  Branch,
  FulfillmentMethod,
  LoyaltyPointsSummary,
  RedemptionStatus,
  RewardItem,
  RewardRedemptionOrder,
  User,
} from '../types';
import { useTranslation } from '../utils/i18n';
import { PortalBackgroundImage } from './PortalBackgroundImage';

interface ShopperRewardsViewProps {
  user: User | null;
  token: string | null;
  activeBranch: Branch | null;
  loyaltySummary: LoyaltyPointsSummary | null;
  onRefreshLoyalty: () => Promise<void> | void;
  onRequestSignIn?: () => void;
}

export const ShopperRewardsView: React.FC<ShopperRewardsViewProps> = ({
  user,
  token,
  activeBranch,
  loyaltySummary,
  onRefreshLoyalty,
  onRequestSignIn,
}) => {
  const { t, language } = useTranslation();
  const [subTab, setSubTab] = useState<'catalogue' | 'orders' | 'ledger'>('catalogue');
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [orders, setOrders] = useState<RewardRedemptionOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingRewards, setIsLoadingRewards] = useState(true);

  // Per-reward selected color & size
  const [selectedColorMap, setSelectedColorMap] = useState<Record<string, string>>({});
  const [selectedSizeMap, setSelectedSizeMap] = useState<Record<string, string>>({});

  // Redeem modal state
  const [redeemTarget, setRedeemTarget] = useState<{
    reward: RewardItem;
    size: string;
    color: string;
  } | null>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>('collection');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [contactPhone, setContactPhone] = useState<string>(user?.phone || '');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [isSubmittingRedeem, setIsSubmittingRedeem] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);

  const loadRewardsAndBranches = async () => {
    setIsLoadingRewards(true);
    try {
      const [rewRes, brRes] = await Promise.all([
        fetch('/api/rewards'),
        fetch('/api/branches'),
      ]);
      if (rewRes.ok) {
        const list: RewardItem[] = await rewRes.json();
        setRewards(Array.isArray(list) ? list : []);
      }
      if (brRes.ok) {
        const brList: Branch[] = await brRes.json();
        if (Array.isArray(brList)) {
          setBranches(brList);
          if (!selectedBranchId) {
            setSelectedBranchId(activeBranch?.id || brList[0]?.id || '');
          }
        }
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setIsLoadingRewards(false);
    }
  };

  const loadOrders = async () => {
    if (!user || !token || user.role !== 'shopper') {
      setOrders([]);
      return;
    }
    try {
      const res = await fetch('/api/shopper/rewards/redemptions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: RewardRedemptionOrder[] = await res.json();
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    void loadRewardsAndBranches();
  }, []);

  useEffect(() => {
    setContactPhone((prev) => prev || user?.phone || '');
    void loadOrders();
  }, [user?.id, token]);

  useEffect(() => {
    if (activeBranch?.id) {
      setSelectedBranchId((prev) => prev || activeBranch.id);
    }
  }, [activeBranch?.id]);

  const balance = loyaltySummary?.totalPoints ?? 0;
  const lifetime = loyaltySummary?.lifetimePoints ?? 0;
  const tier = loyaltySummary?.tier ?? 'Bronze';
  const isFrozen = Boolean(loyaltySummary?.isFrozen || user?.status === 'suspended');

  // Determine nearest/next reward target for progress bar
  const nextReward = useMemo(() => {
    if (rewards.length === 0) return null;
    const sorted = [...rewards].sort((a, b) => a.pointsCost - b.pointsCost);
    const affordableHigher = sorted.find((r) => r.pointsCost > balance);
    return affordableHigher || sorted[0];
  }, [rewards, balance]);

  const nextRewardProgress = useMemo(() => {
    if (!nextReward || nextReward.pointsCost <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((balance / nextReward.pointsCost) * 100)));
  }, [balance, nextReward]);

  const tierLabel =
    tier === 'Gold'
      ? t.loyaltyTierGold
      : tier === 'Silver'
      ? t.loyaltyTierSilver
      : t.loyaltyTierBronze;

  const getChosenColor = (reward: RewardItem): string => {
    return selectedColorMap[reward.id] || reward.colors[0] || 'Default';
  };

  const getChosenSize = (reward: RewardItem): string => {
    const explicit = selectedSizeMap[reward.id];
    if (explicit && reward.sizes.includes(explicit)) return explicit;
    const inStockSize = reward.sizes.find((sz) => (reward.stockBySize?.[sz] ?? 0) > 0);
    return inStockSize || reward.sizes[0] || 'One Size';
  };

  const handleOpenRedeem = (reward: RewardItem) => {
    const color = getChosenColor(reward);
    const size = getChosenSize(reward);
    setRedeemError(null);
    setFulfillmentMethod('collection');
    setSelectedBranchId(activeBranch?.id || branches[0]?.id || '');
    setContactPhone(user?.phone || '');
    setDeliveryAddress('');
    setRedeemTarget({ reward, size, color });
  };

  const handleConfirmRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!redeemTarget || !token) return;

    setRedeemError(null);
    setIsSubmittingRedeem(true);
    try {
      const res = await fetch('/api/shopper/rewards/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rewardId: redeemTarget.reward.id,
          size: redeemTarget.size,
          color: redeemTarget.color,
          fulfillmentMethod,
          branchId: fulfillmentMethod === 'collection' ? selectedBranchId : undefined,
          contactPhone: contactPhone.trim(),
          deliveryAddress: fulfillmentMethod === 'delivery' ? deliveryAddress.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRedeemError(data.error || 'Could not submit redemption request.');
      } else {
        setRedeemTarget(null);
        setOrderNotice(
          data.order?.notificationMessage || `${t.rewardsOrderPlaced} (${data.order?.referenceCode})`
        );
        await Promise.all([onRefreshLoyalty(), loadOrders(), loadRewardsAndBranches()]);
        setSubTab('orders');
      }
    } catch (err: any) {
      setRedeemError(err?.message || 'Network error while submitting request.');
    } finally {
      setIsSubmittingRedeem(false);
    }
  };

  const formatStatusLabel = (status: RedemptionStatus): string => {
    switch (status) {
      case 'requested':
        return t.rewardsStatusRequested;
      case 'approved':
        return t.rewardsStatusApproved;
      case 'ready':
        return t.rewardsStatusReady;
      case 'dispatched':
        return t.rewardsStatusDispatched;
      case 'completed':
        return t.rewardsStatusCompleted;
      case 'cancelled':
        return t.rewardsStatusCancelled;
    }
  };

  const statusTone = (status: RedemptionStatus): string => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300';
      case 'approved':
      case 'ready':
      case 'dispatched':
        return 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300';
      case 'cancelled':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300';
      default:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300';
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="portal-banner-surface relative overflow-hidden p-5 rounded-3xl shadow-md space-y-3">
        <PortalBackgroundImage portal="shopper" variant="banner" />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-200 shrink-0" />
              <h2 className="text-lg font-extrabold text-white truncate">{t.rewardsTitle}</h2>
            </div>
            <p className="text-xs text-emerald-50/95 mt-0.5">{t.rewardsSubtitle}</p>
          </div>
          {user && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/15 border border-white/25 text-xs font-bold text-white shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>{tierLabel}</span>
            </span>
          )}
        </div>

        {/* Balance & Next Reward Progress */}
        {user ? (
          <div className="relative z-10 p-3.5 rounded-2xl bg-black/25 backdrop-blur-xs border border-white/15 space-y-2 text-white">
            <div className="flex items-end justify-between gap-2">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-200">
                  {t.loyaltyTotalBalance}
                </span>
                <p className="text-2xl font-black font-mono tabular-nums leading-tight">
                  {balance.toLocaleString()}{' '}
                  <span className="text-xs font-bold text-emerald-100">{t.loyaltyPointsUnit}</span>
                </p>
              </div>
              <div className="text-right text-[11px] text-emerald-100 tabular-nums">
                <p>{t.loyaltyLifetimeLabel}: {lifetime.toLocaleString()} {t.loyaltyPointsUnit}</p>
                <p>1 pt / KES {loyaltySummary?.earnRateKes ?? 25} + {loyaltySummary?.bonusPointsPerVerifiedCart ?? 5} {t.loyaltyPointsUnit}</p>
              </div>
            </div>

            {nextReward && (
              <div className="space-y-1">
                <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-300 transition-all duration-300"
                    style={{ width: `${nextRewardProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-emerald-50 tabular-nums">
                  {balance >= nextReward.pointsCost
                    ? t.rewardsUnlockedNotice
                    : `${(nextReward.pointsCost - balance).toLocaleString()} ${t.loyaltyPointsUnit} ${t.rewardsProgressNext} (${language === 'sw' && nextReward.nameSw ? nextReward.nameSw : nextReward.name})`}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="relative z-10 p-3.5 rounded-2xl bg-black/25 border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-white">
            <p className="text-xs leading-relaxed text-emerald-50">{t.rewardsGuestBanner}</p>
            {onRequestSignIn && (
              <button
                type="button"
                onClick={onRequestSignIn}
                className="px-4 py-2 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 font-bold text-xs shrink-0 transition"
              >
                {t.login}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Suspended Account Warning */}
      {isFrozen && (
        <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2 font-semibold">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{t.loyaltyFrozenNotice}</span>
        </div>
      )}

      {/* Order Confirmation Banner */}
      {orderNotice && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2 font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{orderNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setOrderNotice(null)}
            className="p-1 text-emerald-600 hover:text-emerald-800"
            aria-label={t.cancel}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub-navigation: Catalogue | My Redemptions | Points Ledger */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('catalogue')}
          className={`py-2 px-2 rounded-xl text-xs font-bold transition min-h-[40px] ${
            subTab === 'catalogue'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.rewardsCatalogueTab}
        </button>
        <button
          type="button"
          onClick={() => {
            setSubTab('orders');
            void loadOrders();
          }}
          className={`py-2 px-2 rounded-xl text-xs font-bold transition min-h-[40px] ${
            subTab === 'orders'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.rewardsMyRedemptionsTab} {orders.length > 0 ? `(${orders.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => {
            setSubTab('ledger');
            void onRefreshLoyalty();
          }}
          className={`py-2 px-2 rounded-xl text-xs font-bold transition min-h-[40px] ${
            subTab === 'ledger'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.rewardsLedgerTab}
        </button>
      </div>

      {/* SUBTAB 1: REWARDS CATALOGUE */}
      {subTab === 'catalogue' && (
        <div className="space-y-4">
          {isLoadingRewards ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              Loading rewards...
            </div>
          ) : rewards.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              {t.rewardsNoRewardsAvailable}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rewards.map((reward) => {
                const chosenColor = getChosenColor(reward);
                const chosenSize = getChosenSize(reward);
                const sizeStock = Number(reward.stockBySize?.[chosenSize] ?? 0);
                const shortBy = Math.max(0, reward.pointsCost - balance);
                const canAfford = Boolean(user && user.role === 'shopper' && !isFrozen && shortBy === 0);
                const localizedName = language === 'sw' && reward.nameSw ? reward.nameSw : reward.name;
                const localizedDesc =
                  language === 'sw' && reward.descriptionSw ? reward.descriptionSw : reward.description;

                return (
                  <article
                    key={reward.id}
                    className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden flex flex-col"
                  >
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-4 flex items-center justify-center border-b border-slate-100 dark:border-slate-800">
                      <img
                        src={reward.imageUrl}
                        alt={localizedName}
                        width={220}
                        height={180}
                        loading="lazy"
                        className="w-40 h-36 object-contain"
                      />
                    </div>

                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white leading-snug">
                            {localizedName}
                          </h3>
                          <span className="px-2.5 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-black font-mono tabular-nums shrink-0">
                            {reward.pointsCost.toLocaleString()} {t.loyaltyPointsUnit}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {localizedDesc}
                        </p>

                        {/* Colour Selector */}
                        {reward.colors.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                              {t.rewardsSelectColor}:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {reward.colors.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() =>
                                    setSelectedColorMap((prev) => ({ ...prev, [reward.id]: c }))
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                    chosenColor === c
                                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Size Selector */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-600 dark:text-slate-400">
                              {t.rewardsSelectSize}:
                            </span>
                            <span
                              className={`font-semibold tabular-nums ${
                                sizeStock > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {sizeStock > 0 ? `${sizeStock} ${t.rewardsInStockCount}` : t.rewardsOutOfStock}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {reward.sizes.map((sz) => {
                              const st = Number(reward.stockBySize?.[sz] ?? 0);
                              const isOut = st <= 0;
                              const selected = chosenSize === sz;
                              return (
                                <button
                                  key={sz}
                                  type="button"
                                  disabled={isOut}
                                  onClick={() =>
                                    setSelectedSizeMap((prev) => ({ ...prev, [reward.id]: sz }))
                                  }
                                  className={`min-w-[38px] px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                                    isOut
                                      ? 'border-slate-200 dark:border-slate-800 text-slate-400 line-through opacity-55 cursor-not-allowed'
                                      : selected
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-500'
                                  }`}
                                >
                                  {sz}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Redeem CTA or Insufficient Points State */}
                      <div className="pt-2">
                        {!user ? (
                          <button
                            type="button"
                            onClick={onRequestSignIn}
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-bold transition"
                          >
                            {t.rewardsSignInToRedeem}
                          </button>
                        ) : sizeStock <= 0 ? (
                          <button
                            type="button"
                            disabled
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold cursor-not-allowed"
                          >
                            {t.rewardsOutOfStock} ({chosenSize})
                          </button>
                        ) : !canAfford ? (
                          <button
                            type="button"
                            disabled
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold cursor-not-allowed tabular-nums"
                          >
                            {isFrozen
                              ? t.suspended
                              : `${t.rewardsNotEnoughPoints} · ${t.rewardsNeedMorePts.replace('{n}', shortBy.toLocaleString())}`}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenRedeem(reward)}
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm"
                          >
                            <Gift className="w-4 h-4" />
                            <span>{t.rewardsRedeemBtn}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Zero-payment notice */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Ban className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{t.rewardsDeliveryNoPaymentNote}</span>
          </div>
        </div>
      )}

      {/* SUBTAB 2: MY REDEMPTIONS */}
      {subTab === 'orders' && (
        <div className="space-y-3">
          {!user ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3">
              <Gift className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.rewardsSignInToRedeem}</p>
              {onRequestSignIn && (
                <button
                  type="button"
                  onClick={onRequestSignIn}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                >
                  {t.login}
                </button>
              )}
            </div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
              <Gift className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.rewardsNoOrdersYet}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.rewardsNoOrdersDesc}</p>
            </div>
          ) : (
            orders.map((order) => (
              <article
                key={order.id}
                className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={order.rewardImageUrl}
                      alt={order.rewardName}
                      width={56}
                      height={56}
                      className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 object-contain p-1 border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                          {order.referenceCode}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${statusTone(order.status)}`}>
                          {formatStatusLabel(order.status)}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate mt-0.5">
                        {order.rewardName}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t.rewardsSelectSize}: <strong>{order.size}</strong> · {t.rewardsSelectColor}:{' '}
                        <strong>{order.color}</strong>
                      </p>
                    </div>
                  </div>

                  <span className="font-mono text-xs font-black text-slate-900 dark:text-white tabular-nums shrink-0">
                    -{order.pointsCost.toLocaleString()} {t.loyaltyPointsUnit}
                  </span>
                </div>

                {/* Fulfillment summary */}
                <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {order.fulfillmentMethod === 'collection' ? (
                      <>
                        <Store className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {t.rewardsCollectBranch}: {order.supermarketName} — {order.branchName}
                        </span>
                      </>
                    ) : (
                      <>
                        <Truck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {t.rewardsDeliveryOption}: {order.deliveryAddress}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Status Notification Message */}
                {order.notificationMessage && (
                  <div
                    className={`p-2.5 rounded-xl text-[11px] font-medium flex items-start gap-2 ${
                      order.status === 'cancelled'
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                        : 'bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p>{order.notificationMessage}</p>
                      {order.status === 'cancelled' && order.pointsRefunded && (
                        <p className="font-bold mt-0.5">{t.rewardsPointsRefunded}</p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}

      {/* SUBTAB 3: POINTS LEDGER */}
      {subTab === 'ledger' && (
        <div className="space-y-3">
          {!user ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
              <Award className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.rewardsSignInToRedeem}</p>
            </div>
          ) : (loyaltySummary?.ledger?.length ?? 0) === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
              <ReceiptText className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.loyaltyNoHistoryYet}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {loyaltySummary!.ledger.map((entry) => {
                const pos = entry.amount >= 0;
                return (
                  <div
                    key={entry.id}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        {entry.reason}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        {new Date(entry.createdAt).toLocaleString()} · {t.loyaltyTotalBalance}:{' '}
                        {entry.balanceAfter.toLocaleString()} {t.loyaltyPointsUnit}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-xl text-xs font-black font-mono tabular-nums shrink-0 ${
                        pos
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {pos ? `+${entry.amount}` : entry.amount}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* REDEEM MODAL */}
      {redeemTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    {redeemTarget.reward.name}
                  </h3>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    {redeemTarget.size} · {redeemTarget.color} · {redeemTarget.reward.pointsCost.toLocaleString()} {t.loyaltyPointsUnit}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRedeemTarget(null)}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800"
                aria-label={t.cancel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {redeemError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{redeemError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmRedeem} className="space-y-3.5">
              {/* Fulfillment Choice */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  {t.rewardsFulfillmentLabel}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFulfillmentMethod('collection')}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col gap-1 ${
                      fulfillmentMethod === 'collection'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Store className="w-4 h-4" />
                    <span className="text-xs font-bold leading-snug">{t.rewardsCollectBranch}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFulfillmentMethod('delivery')}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col gap-1 ${
                      fulfillmentMethod === 'delivery'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Truck className="w-4 h-4" />
                    <span className="text-xs font-bold leading-snug">{t.rewardsDeliveryOption}</span>
                  </button>
                </div>
              </div>

              {fulfillmentMethod === 'collection' ? (
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {t.rewardsChooseBranch}
                  </label>
                  <select
                    required
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  >
                    {branches.map((br) => (
                      <option key={br.id} value={br.id}>
                        {br.name} ({br.city})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                    {t.rewardsDeliveryAddress}
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder={t.rewardsDeliveryAddressPlaceholder}
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  />
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-xl">
                    {t.rewardsDeliveryNoPaymentNote}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {t.rewardsContactPhone}
                </label>
                <input
                  type="tel"
                  required
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+2547..."
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800 leading-relaxed">
                {t.rewardsPrivacyNote}
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRedeemTarget(null)}
                  className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRedeem || (fulfillmentMethod === 'collection' && !selectedBranchId)}
                  className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition"
                >
                  {isSubmittingRedeem ? t.rewardsRedeeming : t.rewardsConfirmRedeem}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
