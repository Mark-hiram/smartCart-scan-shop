// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, MapPin, Zap, Trash2, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';

interface MapsPlace {
  title: string;
  uri: string;
  reviewSnippets?: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  model?: string;
  places?: MapsPlace[];
}

export const SmartCartChat: React.FC = () => {
  const { branch, token } = useAuth();
  const { t, language } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [useMapsGrounding, setUseMapsGrounding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleToggleMaps = () => {
    const next = !useMapsGrounding;
    setUseMapsGrounding(next);
    if (next && !coords && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setErrorMsg(null);
    setIsSending(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: trimmed,
          history: messages.map((m) => ({ role: m.role, text: m.text })),
          branchId: branch?.id,
          language,
          fastMode,
          useMapsGrounding,
          lat: coords?.lat,
          lng: coords?.lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Assistant unavailable.');
      } else {
        const modelMsg: ChatMessage = {
          id: `m_${Date.now()}`,
          role: 'model',
          text: data.reply || '',
          model: data.model,
          places: data.places || [],
        };
        setMessages((prev) => [...prev, modelMsg]);
      }
    } catch {
      setErrorMsg('Network error reaching Smart Cart Assistant.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Floating Chat Trigger */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={t.aiAssistantTitle}
          className="fixed bottom-24 right-4 z-40 w-12 h-12 rounded-2xl bg-slate-900 dark:bg-emerald-600 text-white shadow-xl border border-slate-700/50 dark:border-emerald-500 flex items-center justify-center hover:scale-105 active:scale-95 transition"
        >
          <Sparkles className="w-5 h-5 text-emerald-400 dark:text-white" />
        </button>
      )}

      {/* Slide-over Chat Drawer */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm h-[520px] max-h-[82vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in fade-in">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <h4 className="text-xs font-bold leading-tight">{t.aiAssistantTitle}</h4>
                <p className="text-[10px] text-slate-400 truncate max-w-[170px]">
                  {branch ? `${branch.name}` : 'Smart Cart Platform'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setErrorMsg(null);
                  }}
                  title={t.aiClearChat}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mode Toggles */}
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFastMode(!fastMode)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition ${
                fastMode && !useMapsGrounding
                  ? 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>{t.aiFastMode}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleMaps}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition ${
                useMapsGrounding
                  ? 'bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-700 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <MapPin className="w-3 h-3" />
              <span>{t.aiMapsToggle}</span>
            </button>
          </div>

          {/* Messages Thread */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 px-4 space-y-2">
                <Sparkles className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t.aiAssistantTitle}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t.aiInputPlaceholder}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                  }`}
                >
                  {msg.role === 'model' ? (
                    <div className="prose prose-xs dark:prose-invert max-w-none break-words">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <span>{msg.text}</span>
                  )}
                </div>

                {/* Clickable Google Maps Grounding Links */}
                {msg.places && msg.places.length > 0 && (
                  <div className="mt-1.5 space-y-1 max-w-[88%]">
                    {msg.places.map((pl, idx) => (
                      <a
                        key={idx}
                        href={pl.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100 transition text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-1 font-bold text-emerald-800 dark:text-emerald-300">
                          <span className="truncate">{pl.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </div>
                        {pl.reviewSnippets && pl.reviewSnippets[0] && (
                          <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                            “{pl.reviewSnippets[0]}”
                          </p>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isSending && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 pl-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" />
                <span>Thinking...</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input Bar */}
          <form
            onSubmit={handleSend}
            className="p-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.aiInputPlaceholder}
              className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-emerald-500"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};
