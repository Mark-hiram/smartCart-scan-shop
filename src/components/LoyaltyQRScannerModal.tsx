import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, Camera, Upload, Trash2, Award, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { LoyaltyCard, Supermarket } from '../types';
import { useTranslation } from '../utils/i18n';

interface LoyaltyQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId?: string;
  activeSupermarketId?: string;
  loyaltyCards: LoyaltyCard[];
  onCardLinked: (card: LoyaltyCard) => void;
  onCardRemoved: (cardId: string) => void;
  getHeaders: () => Record<string, string>;
}

interface SampleQrItem {
  supermarketName: string;
  supermarketCode: string;
  payload: string;
  dataUrl: string;
}

export const LoyaltyQRScannerModal: React.FC<LoyaltyQRScannerModalProps> = ({
  isOpen,
  onClose,
  branchId,
  activeSupermarketId,
  loyaltyCards,
  onCardLinked,
  onCardRemoved,
  getHeaders,
}) => {
  const { t } = useTranslation();
  const [manualPayload, setManualPayload] = useState('');
  const [isScanningCamera, setIsScanningCamera] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sampleQrs, setSampleQrs] = useState<SampleQrItem[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop camera cleanly
  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setIsScanningCamera(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // Load active supermarkets to generate store-specific sample QR codes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/supermarkets')
      .then((r) => r.json())
      .then(async (list: Supermarket[]) => {
        if (!Array.isArray(list) || cancelled) return;
        const samples = await Promise.all(
          list.slice(0, 4).map(async (sm, idx) => {
            const code = sm.code.toUpperCase();
            const cardNum = `${code.substring(0, 2)}-${884210 + idx * 137}`;
            const payload = `SMARTCART:LOYALTY:${code}:${cardNum}`;
            const dataUrl = await QRCode.toDataURL(payload, { width: 128, margin: 1 });
            return {
              supermarketName: sm.name,
              supermarketCode: code,
              payload,
              dataUrl,
            };
          })
        );
        if (!cancelled) setSampleQrs(samples);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const submitQrPayload = async (rawPayload: string) => {
    const trimmed = rawPayload.trim();
    if (!trimmed) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/shopper/loyalty/scan', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ qrPayload: trimmed, branchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not recognize loyalty QR code.');
      } else if (data.card) {
        onCardLinked(data.card);
        setSuccessMsg(`${data.card.supermarketName} card ${data.card.cardNumber} linked (${data.card.points} pts)!`);
        setManualPayload('');
        stopCamera();
      }
    } catch {
      setErrorMsg('Network error while linking loyalty card.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startCameraScanner = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('Camera access is not supported in this browser. Use Upload QR Image or manual entry.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setIsScanningCamera(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      const detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ['qr_code'] }) : null;

      const scanFrame = async () => {
        const video = videoRef.current;
        if (!video || !streamRef.current) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          // 1. Try native BarcodeDetector first if available
          if (detector) {
            try {
              const detected = await detector.detect(video);
              if (detected && detected.length > 0 && detected[0].rawValue) {
                await submitQrPayload(detected[0].rawValue);
                return;
              }
            } catch {
              // Fall through to jsQR
            }
          }

          // 2. Fallback to jsQR canvas decoding
          const canvas = canvasRef.current;
          if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const qr = jsQR(imgData.data, imgData.width, imgData.height);
              if (qr && qr.data) {
                await submitQrPayload(qr.data);
                return;
              }
            }
          }
        }

        rafRef.current = requestAnimationFrame(scanFrame);
      };

      rafRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setErrorMsg('Unable to open camera. Grant camera permissions or upload a QR image below.');
      setIsScanningCamera(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (decoded && decoded.data) {
          submitQrPayload(decoded.data);
        } else {
          setErrorMsg('No readable QR code found in the selected image.');
        }
      }
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setErrorMsg('Could not read the uploaded image file.');
    };
    img.src = objectUrl;
    e.target.value = '';
  };

  const handleRemoveCard = async (cardId: string) => {
    try {
      const res = await fetch(`/api/shopper/loyalty/${cardId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (res.ok) {
        onCardRemoved(cardId);
      }
    } catch {
      setErrorMsg('Failed to remove loyalty card.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.loyaltyQrTitle}</h3>
              <p className="text-[11px] text-slate-500">{t.loyaltyQrDesc}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* Status alerts */}
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Camera preview or action buttons */}
          {isScanningCamera ? (
            <div className="space-y-2">
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video border border-emerald-500/40">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-40 h-40 border-2 border-emerald-400 rounded-2xl shadow-lg shadow-emerald-500/20" />
                </div>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                className="w-full py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold"
              >
                Stop Camera
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={startCameraScanner}
                className="py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-sm"
              >
                <Camera className="w-4 h-4" />
                <span>{t.loyaltyQrScanBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="py-3 px-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition"
              >
                <Upload className="w-4 h-4" />
                <span>{t.loyaltyUploadImage}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
          )}

          {/* Manual Loyalty QR / Member ID Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitQrPayload(manualPayload);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualPayload}
              onChange={(e) => setManualPayload(e.target.value)}
              placeholder={t.loyaltyManualPlaceholder}
              className="flex-1 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={isSubmitting || !manualPayload.trim()}
              className="px-4 h-10 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold"
            >
              Link
            </button>
          </form>

          {/* Linked Store Loyalty Cards */}
          {loyaltyCards.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                <span>Linked Store Cards ({loyaltyCards.length})</span>
              </p>
              {loyaltyCards.map((card) => {
                const isActiveChain = activeSupermarketId === card.supermarketId;
                return (
                  <div
                    key={card.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between ${
                      isActiveChain
                        ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {card.supermarketName}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                          {card.tier}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {card.cardNumber} · {card.points.toLocaleString()} pts
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCard(card.id)}
                      title={t.loyaltyUnlink}
                      className="p-2 text-slate-400 hover:text-rose-600 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Store-Specific Sample QR Cards for Testing */}
          {sampleQrs.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                <span>{t.loyaltySamplesTitle}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sampleQrs.map((sq) => (
                  <button
                    key={sq.supermarketCode}
                    type="button"
                    onClick={() => submitQrPayload(sq.payload)}
                    disabled={isSubmitting}
                    className="p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 hover:border-emerald-500 text-center flex flex-col items-center gap-1.5 transition active:scale-98"
                  >
                    <img
                      src={sq.dataUrl}
                      alt={`${sq.supermarketName} Loyalty QR`}
                      className="w-20 h-20 rounded-lg border border-slate-100"
                    />
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate w-full">
                      {sq.supermarketName}
                    </span>
                    <span className="text-[9px] font-mono text-emerald-600 dark:text-emerald-400 truncate w-full">
                      Tap to Link QR
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
