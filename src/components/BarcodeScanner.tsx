import React, { useRef, useEffect, useState } from 'react';
import { Camera, Flashlight, FlashlightOff, Search, AlertCircle, CheckCircle2, RotateCw } from 'lucide-react';
import { validateBarcode } from '../utils/barcode';
import { useTranslation } from '../utils/i18n';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  isPriceCheckMode?: boolean;
  onTogglePriceCheckMode?: () => void;
  onOpenManualInput?: () => void;
  sampleBarcodes?: { name: string; barcode: string; price: number }[];
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  isPriceCheckMode = false,
  onTogglePriceCheckMode,
  onOpenManualInput,
  sampleBarcodes = [],
}) => {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanningActive, setIsScanningActive] = useState(true);

  // Play audio beep upon successful barcode detection
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime); // 1.2 kHz supermarket till beep
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      // AudioContext not allowed or muted
    }

    // Haptic vibration
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(80);
      } catch (e) {}
    }
  };

  const handleBarcodeDetected = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (lastScanned === trimmed) return; // debounce same code in rapid succession

    setLastScanned(trimmed);
    playBeep();
    onScan(trimmed);

    // Reset last scanned after 2.5 seconds to allow rescanning the same item
    setTimeout(() => {
      setLastScanned(null);
    }, 2500);
  };

  // Start camera stream
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasCamera(false);
        setCameraError('Camera API is not supported in this browser environment.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasCamera(true);

      // Check if torch is supported
      const track = stream.getVideoTracks()[0];
      const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      if (capabilities && capabilities.torch) {
        setTorchSupported(true);
      }
    } catch (err: any) {
      console.warn('Camera access issue:', err);
      setHasCamera(false);
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera permissions to scan, or use manual entry below.'
          : 'Unable to start camera preview. You can enter or tap barcodes below.'
      );
    }
  };

  // Toggle flashlight / torch
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && torchSupported) {
      try {
        const next = !torchEnabled;
        await (track as any).applyConstraints({
          advanced: [{ torch: next }],
        });
        setTorchEnabled(next);
      } catch (e) {
        console.warn('Failed to toggle torch:', e);
      }
    }
  };

  useEffect(() => {
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Continuous frame barcode detection loop using window.BarcodeDetector
  useEffect(() => {
    let animationFrameId: number;
    let isDetecting = false;

    const checkFrame = async () => {
      if (
        !isDetecting &&
        isScanningActive &&
        videoRef.current &&
        videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA &&
        'BarcodeDetector' in window
      ) {
        isDetecting = true;
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'],
          });
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const rawVal = barcodes[0].rawValue;
            if (rawVal) {
              handleBarcodeDetected(rawVal);
            }
          }
        } catch (e) {
          // Frame detection transient error
        } finally {
          isDetecting = false;
        }
      }

      animationFrameId = requestAnimationFrame(checkFrame);
    };

    if (hasCamera) {
      animationFrameId = requestAnimationFrame(checkFrame);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [hasCamera, isScanningActive, lastScanned]);

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      {/* Mode Switcher Banner: Add to Cart vs Price Check Mode */}
      <div className="w-full mb-3 flex items-center justify-between p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
        <button
          onClick={() => isPriceCheckMode && onTogglePriceCheckMode?.()}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            !isPriceCheckMode
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
          }`}
        >
          {t.addToCart}
        </button>
        <button
          onClick={() => !isPriceCheckMode && onTogglePriceCheckMode?.()}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
            isPriceCheckMode
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
          }`}
        >
          {t.priceCheckMode}
        </button>
      </div>

      {/* Camera Viewport Container */}
      <div className="relative w-full aspect-4/3 rounded-2xl overflow-hidden bg-slate-950 shadow-md border border-slate-200 dark:border-slate-800 flex items-center justify-center">
        {/* Video Element */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${hasCamera ? 'block' : 'hidden'}`}
        />

        {/* Viewport Overlay & Reticle */}
        {hasCamera && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Darkened mask around target reticle */}
            <div className="relative w-64 h-36 border-2 border-emerald-400 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] flex items-center justify-center">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-sm" />
              <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-sm" />
              <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-sm" />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-sm" />

              {/* Animated laser scan line */}
              <div className="w-full h-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] animate-scanline" />
            </div>

            {/* Instruction tooltip */}
            <div className="absolute bottom-4 bg-black/70 backdrop-blur-xs text-white text-[11px] font-medium px-3 py-1 rounded-full">
              {t.pointCamera}
            </div>
          </div>
        )}

        {/* Camera Fallback State (when camera is disabled or in mock desktop environment) */}
        {!hasCamera && (
          <div className="p-6 text-center text-slate-300 flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <Camera className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">
              {t.cameraScanner}
            </p>
            <p className="text-xs text-slate-400 max-w-[280px] mb-4">
              {cameraError || t.pointCamera}
            </p>
            <button
              onClick={startCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-emerald-300 rounded-lg transition"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry Camera</span>
            </button>
          </div>
        )}

        {/* Torch / Flashlight Button */}
        {torchSupported && hasCamera && (
          <button
            onClick={toggleTorch}
            className="absolute top-3 right-3 p-2.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition active:scale-90"
            title={torchEnabled ? t.flashOff : t.flashOn}
          >
            {torchEnabled ? (
              <FlashlightOff className="w-4 h-4 text-amber-400" />
            ) : (
              <Flashlight className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Success Scan Feedback Overlay */}
        {lastScanned && (
          <div className="absolute inset-0 bg-emerald-600/30 backdrop-blur-xs flex items-center justify-center animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-xl border border-emerald-500 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  {isPriceCheckMode ? t.priceCheckSuccess : t.scanSuccess}
                </p>
                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {lastScanned}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual Input & Search Trigger */}
      <div className="w-full mt-3 flex gap-2">
        <button
          onClick={onOpenManualInput}
          className="flex-1 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-xs flex items-center justify-center gap-2 shadow-xs active:scale-98 transition"
        >
          <Search className="w-4 h-4 text-emerald-600" />
          <span>{t.typeBarcodeManually}</span>
        </button>
      </div>

      {/* Quick Test Demo Shelf: Tap-to-Scan Realistic Barcodes */}
      {sampleBarcodes.length > 0 && (
        <div className="w-full mt-4 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              Demo Supermarket Shelf (Tap to simulate physical scan):
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {sampleBarcodes.slice(0, 6).map((item) => (
              <button
                key={item.barcode}
                onClick={() => handleBarcodeDetected(item.barcode)}
                className="flex flex-col text-left p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-xs transition active:scale-95"
              >
                <span className="font-semibold text-slate-900 dark:text-white truncate">
                  {item.name}
                </span>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                  <span className="font-mono tabular-nums">{item.barcode}</span>
                  <span className="font-bold text-emerald-600">KES {item.price}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
