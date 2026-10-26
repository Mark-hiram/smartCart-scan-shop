import React, { useState, useEffect } from 'react';
import { History, X, Calendar, ShoppingBag, ArrowRight, Store, ChevronRight, Award } from 'lucide-react';
import { api } from '../api.ts';
import { ShoppingSession, Supermarket } from '../types.ts';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  onViewSessionDetails: (session: ShoppingSession) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  customerId,
  onViewSessionDetails,
}) => {
  const [sessions, setSessions] = useState<ShoppingSession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    loadHistory();
  }, [isOpen, customerId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await api.getCustomerHistory(customerId);
      if (res.success) {
        setSessions(res.sessions);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-950 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center font-bold">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight">Shopping History</h2>
              <p className="text-[10px] text-emerald-300">Previous shopping receipts &amp; visits</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-emerald-900 hover:bg-emerald-800 text-emerald-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
          {loading ? (
            <p className="text-center py-10 text-xs text-slate-400">Loading history...</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <ShoppingBag className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">No previous shopping sessions yet.</p>
              <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                Once you scan products and complete a shopping trip, your digital receipt will appear here.
              </p>
            </div>
          ) : (
            sessions.map((sess) => (
              <div
                key={sess.id}
                onClick={() => {
                  onViewSessionDetails(sess);
                  onClose();
                }}
                className="p-3.5 bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 rounded-2xl cursor-pointer transition flex items-center justify-between gap-3 group"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span className="font-extrabold text-xs text-slate-900 truncate">
                      {sess.supermarket_name || 'Supermarket'}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                        sess.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {sess.status}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {new Date(sess.started_at).toLocaleDateString()}
                    </span>
                    <span>•</span>
                    <span>{sess.items.length} items</span>
                  </div>

                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="font-mono font-bold text-xs text-emerald-800">
                      KSh {sess.estimated_total.toLocaleString()}
                    </span>
                    {sess.status === 'COMPLETED' && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                        <Award className="w-2.5 h-2.5 text-amber-700" />
                        +{sess.loyalty_points_earned ?? Math.floor(sess.estimated_total / 100)} pts
                      </span>
                    )}
                  </div>
                </div>

                <div className="w-7 h-7 rounded-full bg-white border border-slate-200 group-hover:bg-amber-400 group-hover:text-emerald-950 flex items-center justify-center text-slate-400 transition">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
          <button
            onClick={onClose}
            className="text-xs font-bold text-slate-600 hover:text-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
