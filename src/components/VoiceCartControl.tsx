// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, CheckCircle2, AlertCircle, Volume2 } from 'lucide-react';
import { EnrichedProduct } from '../types';
import { Language, useTranslation } from '../utils/i18n';
import {
  findBestMatchingProduct,
  getSpeechRecognitionConstructor,
  isSpeechRecognitionSupported,
  parseVoiceCommand,
  ParsedVoiceCommand,
  SpeechRecognitionInstance,
} from '../utils/voiceCommands';

export interface VoiceCommandExecutionResult {
  ok: boolean;
  message: string;
}

interface VoiceCartControlProps {
  products: EnrichedProduct[];
  language: Language;
  disabled?: boolean;
  onExecuteCommand: (
    command: ParsedVoiceCommand,
    matchedProduct: EnrichedProduct | null
  ) => Promise<VoiceCommandExecutionResult>;
}

export const VoiceCartControl: React.FC<VoiceCartControlProps> = ({
  products,
  language,
  disabled = false,
  onExecuteCommand,
}) => {
  const { t } = useTranslation();
  const [supported] = useState<boolean>(() => isSpeechRecognitionSupported());
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const productsRef = useRef(products);
  const onExecuteRef = useRef(onExecuteCommand);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    onExecuteRef.current = onExecuteCommand;
  }, [onExecuteCommand]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
    setIsListening(false);
  };

  const handleResultTranscripts = async (alternatives: string[]) => {
    const primaryTranscript = alternatives[0] || '';
    if (!primaryTranscript) return;

    setIsProcessing(true);
    try {
      let bestCommand: ParsedVoiceCommand | null = null;
      let bestMatch: EnrichedProduct | null = null;

      for (const alt of alternatives) {
        const parsed = parseVoiceCommand(alt);
        if (!parsed) continue;
        if (!bestCommand) bestCommand = parsed;
        const matched = findBestMatchingProduct(parsed.itemQuery, productsRef.current);
        if (matched) {
          bestCommand = parsed;
          bestMatch = matched;
          break;
        }
      }

      if (!bestCommand) {
        setStatusMessage({
          type: 'error',
          text: `${t.voiceNotFoundPrefix} "${primaryTranscript}"`,
        });
        return;
      }

      const result = await onExecuteRef.current(bestCommand, bestMatch);
      setStatusMessage({
        type: result.ok ? 'success' : 'error',
        text: result.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const startListening = () => {
    if (disabled || isProcessing) return;
    if (isListening) {
      stopListening();
      return;
    }

    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) {
      setStatusMessage({ type: 'error', text: t.voiceUnsupported });
      return;
    }

    setStatusMessage(null);
    setTranscript('');

    const recognition = new RecognitionCtor();
    recognition.lang = language === 'sw' ? 'sw-KE' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      const finalAlternatives: string[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const firstAlt = res[0]?.transcript || '';
        if (res.isFinal) {
          for (let j = 0; j < res.length; j++) {
            const altText = res[j]?.transcript?.trim();
            if (altText) finalAlternatives.push(altText);
          }
        } else {
          interim += firstAlt;
        }
      }

      if (finalAlternatives.length > 0) {
        setTranscript(finalAlternatives[0]);
        setIsListening(false);
        void handleResultTranscripts(finalAlternatives);
      } else if (interim.trim()) {
        setTranscript(interim.trim());
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatusMessage({ type: 'error', text: t.voiceMicDenied });
      } else if (event.error === 'no-speech') {
        setStatusMessage({ type: 'error', text: t.voiceNoSpeech });
      } else if (event.error !== 'aborted') {
        setStatusMessage({ type: 'error', text: t.voiceNoSpeech });
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setStatusMessage({ type: 'error', text: t.voiceNoSpeech });
    }
  };

  return (
    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition ${
              isListening
                ? 'bg-emerald-600 text-white animate-pulse shadow-md shadow-emerald-500/30'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {isListening ? <Volume2 className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
              {t.voiceCartTitle}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isListening ? t.voiceListening : t.voiceCartHint}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={startListening}
          disabled={!supported || disabled || isProcessing}
          aria-pressed={isListening}
          aria-label={isListening ? t.voiceStopBtn : t.voiceStartBtn}
          className={`px-3.5 h-9 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition active:scale-95 disabled:opacity-45 ${
            isListening
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {isListening ? (
            <>
              <MicOff className="w-3.5 h-3.5" />
              <span>{t.voiceStopBtn}</span>
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5" />
              <span>{t.voiceStartBtn}</span>
            </>
          )}
        </button>
      </div>

      {!supported && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{t.voiceUnsupported}</span>
        </p>
      )}

      {transcript && (
        <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 rounded-xl truncate">
          “{transcript}”
        </p>
      )}

      {statusMessage && (
        <div
          role="status"
          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium flex items-center gap-1.5 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
};
