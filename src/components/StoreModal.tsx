import React, { useState, useEffect } from 'react';
import { X, MapPin, Navigation, Store, Check, Compass } from 'lucide-react';
import { Supermarket, Branch } from '../types';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';

interface StoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StoreModal: React.FC<StoreModalProps> = ({ isOpen, onClose }) => {
  const { branch: currentBranch, setBranch } = useAuth();
  const { t } = useTranslation();

  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [selectedSupermarketId, setSelectedSupermarketId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Fetch supermarkets on mount
  useEffect(() => {
    if (isOpen) {
      fetch('/api/supermarkets')
        .then((r) => r.json())
        .then((data) => {
          setSupermarkets(data);
          if (data.length > 0 && !selectedSupermarketId) {
            setSelectedSupermarketId(data[0].id);
          }
        })
        .catch((e) => console.error(e));
    }
  }, [isOpen]);

  // Request GPS Location to calculate nearest branches
  const detectNearestBranch = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setIsLocating(false);
      },
      (err) => {
        console.warn('Geolocation denied or unavailable:', err);
        setIsLocating(false);
      },
      { timeout: 8000 }
    );
  };

  // Fetch branches whenever supermarket or coords change
  useEffect(() => {
    if (!isOpen || !selectedSupermarketId) return;

    let url = `/api/branches?supermarketId=${selectedSupermarketId}`;
    if (userCoords) {
      url += `&lat=${userCoords.lat}&lng=${userCoords.lng}`;
    }

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setBranches(data);
      })
      .catch((e) => console.error(e));
  }, [isOpen, selectedSupermarketId, userCoords]);

  if (!isOpen) return null;

  const handleSelectBranch = (b: Branch) => {
    setBranch(b);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t.selectSupermarket} &amp; {t.selectBranch}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* GPS Nearest Branch Action Button */}
          <button
            onClick={detectNearestBranch}
            disabled={isLocating}
            className="w-full py-2.5 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-emerald-100 transition active:scale-98"
          >
            <Navigation className={`w-4 h-4 text-emerald-600 ${isLocating ? 'animate-spin' : ''}`} />
            <span>{isLocating ? t.detectingLocation : t.nearestBranch}</span>
          </button>

          {/* Supermarket Chain Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
              1. {t.selectSupermarket}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {supermarkets.map((sm) => {
                const isSelected = selectedSupermarketId === sm.id;
                return (
                  <button
                    key={sm.id}
                    onClick={() => setSelectedSupermarketId(sm.id)}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      {sm.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono mt-1">
                      {sm.code} Chain
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Branch List */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
              <span>2. {t.selectBranch}</span>
              {userCoords && (
                <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                  <Compass className="w-3 h-3" /> Sorted by distance
                </span>
              )}
            </label>

            <div className="space-y-2">
              {branches.map((b, idx) => {
                const isCurrent = currentBranch?.id === b.id;
                const isNearest = idx === 0 && userCoords;
                return (
                  <div
                    key={b.id}
                    onClick={() => handleSelectBranch(b)}
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
                      isCurrent
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-emerald-400'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {b.name}
                        </span>
                        {isNearest && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded">
                            Nearest
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{b.address}, {b.city}</span>
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {b.distanceKm !== undefined ? (
                        <span className="text-xs font-mono font-bold text-emerald-600 tabular-nums">
                          {b.distanceKm} {t.distanceAway}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {b.code}
                        </span>
                      )}
                      {isCurrent && (
                        <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center ml-auto mt-1">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
