// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import QRCode from 'qrcode';
import { Cart } from '../types';

export type SummaryCardTheme = 'emerald' | 'midnight' | 'crisp';

export interface CartSummaryCardOptions {
  cart: Cart;
  storeName?: string;
  branchName?: string;
  branchLocation?: string;
  theme?: SummaryCardTheme;
}

export interface GeneratedCartSummaryCard {
  dataUrl: string;
  blob: Blob;
  fileName: string;
  summaryText: string;
}

interface ThemePalette {
  bgTop: string;
  bgBottom: string;
  cardBg: string;
  cardBorder: string;
  headerBg: string;
  headerAccent: string;
  headerText: string;
  headerSubtext: string;
  titleColor: string;
  textPrimary: string;
  textSecondary: string;
  rowBg: string;
  divider: string;
  badgeBg: string;
  badgeText: string;
  savingsBg: string;
  savingsText: string;
  totalBoxBg: string;
  totalBoxText: string;
  totalAmountColor: string;
  footerText: string;
}

const THEMES: Record<SummaryCardTheme, ThemePalette> = {
  emerald: {
    bgTop: '#064e3b',
    bgBottom: '#022c22',
    cardBg: '#ffffff',
    cardBorder: '#d1fae5',
    headerBg: '#065f46',
    headerAccent: '#10b981',
    headerText: '#ffffff',
    headerSubtext: '#a7f3d0',
    titleColor: '#0f172a',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    rowBg: '#f8fafc',
    divider: '#e2e8f0',
    badgeBg: '#ecfdf5',
    badgeText: '#047857',
    savingsBg: '#dcfce7',
    savingsText: '#15803d',
    totalBoxBg: '#0f172a',
    totalBoxText: '#cbd5e1',
    totalAmountColor: '#34d399',
    footerText: '#64748b',
  },
  midnight: {
    bgTop: '#0f172a',
    bgBottom: '#020617',
    cardBg: '#0f172a',
    cardBorder: '#1e293b',
    headerBg: '#1e293b',
    headerAccent: '#34d399',
    headerText: '#f8fafc',
    headerSubtext: '#94a3b8',
    titleColor: '#f8fafc',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    rowBg: '#1e293b',
    divider: '#334155',
    badgeBg: '#064e3b',
    badgeText: '#6ee7b7',
    savingsBg: '#065f46',
    savingsText: '#a7f3d0',
    totalBoxBg: '#064e3b',
    totalBoxText: '#d1fae5',
    totalAmountColor: '#ffffff',
    footerText: '#94a3b8',
  },
  crisp: {
    bgTop: '#f1f5f9',
    bgBottom: '#e2e8f0',
    cardBg: '#ffffff',
    cardBorder: '#cbd5e1',
    headerBg: '#0f172a',
    headerAccent: '#10b981',
    headerText: '#ffffff',
    headerSubtext: '#cbd5e1',
    titleColor: '#0f172a',
    textPrimary: '#1e293b',
    textSecondary: '#64748b',
    rowBg: '#f8fafc',
    divider: '#e2e8f0',
    badgeBg: '#ecfdf5',
    badgeText: '#065f46',
    savingsBg: '#fef3c7',
    savingsText: '#b45309',
    totalBoxBg: '#f1f5f9',
    totalBoxText: '#475569',
    totalAmountColor: '#059669',
    footerText: '#64748b',
  },
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trim()}...`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

export function buildCartSummaryText(options: CartSummaryCardOptions): string {
  const { cart, storeName, branchName } = options;
  const totalQty = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const storeLine = [storeName, branchName].filter(Boolean).join(' — ');
  const dateStr = new Date(cart.updatedAt || cart.createdAt).toLocaleString();
  const lines = [
    `Smart Cart Receipt Summary (${cart.shortCode})`,
    storeLine ? `Store: ${storeLine}` : null,
    `Status: ${cart.status.toUpperCase()} · ${dateStr}`,
    `Items (${totalQty}):`,
    ...cart.items.slice(0, 10).map(
      (it) => `- ${it.quantity}x ${it.name}: KES ${it.effectiveTotal.toLocaleString()}`
    ),
    cart.items.length > 10 ? `...and ${cart.items.length - 10} more item(s)` : null,
    cart.totalDiscount > 0 ? `Savings: KES ${cart.totalDiscount.toLocaleString()}` : null,
    `Final Total: KES ${cart.finalTotal.toLocaleString()}`,
  ].filter(Boolean);

  return lines.join('\n');
}

export async function generateCartSummaryCardImage(
  options: CartSummaryCardOptions
): Promise<GeneratedCartSummaryCard> {
  const { cart, storeName, branchName, branchLocation, theme = 'emerald' } = options;
  const palette = THEMES[theme];

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context.');
  }

  // Outer poster backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, palette.bgTop);
  bgGrad.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle decorative glow circles
  ctx.save();
  ctx.globalAlpha = theme === 'crisp' ? 0.25 : 0.14;
  ctx.fillStyle = palette.headerAccent;
  ctx.beginPath();
  ctx.arc(width - 110, 120, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(100, height - 110, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Main Summary Card Container
  const padX = 64;
  const padY = 64;
  const cardW = width - padX * 2;
  const cardH = height - padY * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  drawRoundedRect(ctx, padX, padY, cardW, cardH, 42);
  ctx.fillStyle = palette.cardBg;
  ctx.fill();
  ctx.restore();

  drawRoundedRect(ctx, padX, padY, cardW, cardH, 42);
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Top Header Band clipped to card top
  ctx.save();
  drawRoundedRect(ctx, padX, padY, cardW, cardH, 42);
  ctx.clip();

  const headerH = 260;
  ctx.fillStyle = palette.headerBg;
  ctx.fillRect(padX, padY, cardW, headerH);

  // Accent top stripe
  ctx.fillStyle = palette.headerAccent;
  ctx.fillRect(padX, padY, cardW, 10);
  ctx.restore();

  // Brand mark + Title
  const innerLeft = padX + 48;
  const innerRight = padX + cardW - 48;

  ctx.fillStyle = palette.headerAccent;
  drawRoundedRect(ctx, innerLeft, padY + 46, 56, 56, 16);
  ctx.fill();

  // Shopping bag emblem inside brand mark
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeRect(innerLeft + 16, padY + 66, 24, 22);
  ctx.beginPath();
  ctx.arc(innerLeft + 28, padY + 66, 7, Math.PI, 0);
  ctx.stroke();

  ctx.fillStyle = palette.headerText;
  ctx.font = '800 38px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('Smart Cart', innerLeft + 74, padY + 84);

  const storeDisplay = [storeName, branchName].filter(Boolean).join(' · ') || 'Supermarket Checkout';
  ctx.fillStyle = palette.headerSubtext;
  ctx.font = '600 22px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(truncateText(ctx, storeDisplay, cardW - 310), innerLeft, padY + 140);

  if (branchLocation) {
    ctx.font = '500 19px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(truncateText(ctx, branchLocation, cardW - 310), innerLeft, padY + 172);
  }

  // Checkout Status Pill
  const statusLabel =
    cart.status === 'completed'
      ? 'CHECKOUT COMPLETED'
      : cart.status === 'verified'
      ? 'VERIFIED AT TILL'
      : cart.status === 'flagged'
      ? 'REVIEW AT TILL'
      : 'READY FOR TILL';

  ctx.font = '800 18px Inter, system-ui, -apple-system, sans-serif';
  const statusW = ctx.measureText(statusLabel).width + 38;
  drawRoundedRect(ctx, innerLeft, padY + 194, statusW, 38, 12);
  ctx.fillStyle = palette.headerAccent;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(statusLabel, innerLeft + 19, padY + 219);

  // Embedded QR Code on header right
  const qrSize = 158;
  const qrX = innerRight - qrSize;
  const qrY = padY + 52;
  drawRoundedRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  try {
    const qrDataUrl = await QRCode.toDataURL(cart.shortCode || cart.id, {
      width: 240,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    const qrImg = await loadImage(qrDataUrl);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } catch {
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 24px monospace';
    ctx.fillText(cart.shortCode || 'CART', qrX + 20, qrY + 86);
  }

  // Cart Metadata Bar
  const metaY = padY + headerH + 34;
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '600 19px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('CART CODE', innerLeft, metaY);

  ctx.fillStyle = palette.textPrimary;
  ctx.font = '800 34px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(cart.shortCode, innerLeft, metaY + 38);

  const completedDate = new Date(cart.updatedAt || cart.createdAt);
  const dateText = completedDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeText = completedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  ctx.textAlign = 'right';
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '600 19px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(`${dateText} · ${timeText}`, innerRight, metaY);

  const totalItemQty = cart.items.reduce((sum, it) => sum + it.quantity, 0);
  ctx.fillStyle = palette.textPrimary;
  ctx.font = '700 22px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(`${totalItemQty} item${totalItemQty === 1 ? '' : 's'} checked out`, innerRight, metaY + 36);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(innerLeft, metaY + 62);
  ctx.lineTo(innerRight, metaY + 62);
  ctx.stroke();

  // Purchased Items List (max 7 rows to keep card balanced)
  const listStartY = metaY + 96;
  ctx.fillStyle = palette.textSecondary;
  ctx.font = '700 18px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('FINAL CART SUMMARY', innerLeft, listStartY);

  const maxVisibleItems = 7;
  const visibleItems = cart.items.slice(0, maxVisibleItems);
  const remainingCount = Math.max(0, cart.items.length - maxVisibleItems);
  let rowY = listStartY + 24;
  const rowH = 56;
  const rowGap = 12;

  for (const item of visibleItems) {
    drawRoundedRect(ctx, innerLeft, rowY, cardW - 96, rowH, 16);
    ctx.fillStyle = palette.rowBg;
    ctx.fill();

    // Quantity pill
    drawRoundedRect(ctx, innerLeft + 14, rowY + 12, 54, 32, 10);
    ctx.fillStyle = palette.badgeBg;
    ctx.fill();

    ctx.fillStyle = palette.badgeText;
    ctx.font = '800 19px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${item.quantity}x`, innerLeft + 41, rowY + 34);
    ctx.textAlign = 'left';

    // Product name
    ctx.fillStyle = palette.textPrimary;
    ctx.font = '600 22px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(truncateText(ctx, item.name, cardW - 360), innerLeft + 84, rowY + 35);

    // Line price
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.textPrimary;
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillText(`KES ${item.effectiveTotal.toLocaleString()}`, innerRight - 18, rowY + 35);
    ctx.textAlign = 'left';

    rowY += rowH + rowGap;
  }

  if (remainingCount > 0) {
    ctx.fillStyle = palette.textSecondary;
    ctx.font = '600 20px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `+ ${remainingCount} additional item${remainingCount === 1 ? '' : 's'} included in total`,
      innerLeft + 8,
      rowY + 22
    );
  }

  // Final Totals Box near bottom
  const totalBoxH = 176;
  const totalBoxY = padY + cardH - 86 - totalBoxH;

  drawRoundedRect(ctx, innerLeft, totalBoxY, cardW - 96, totalBoxH, 26);
  ctx.fillStyle = palette.totalBoxBg;
  ctx.fill();

  ctx.fillStyle = palette.totalBoxText;
  ctx.font = '600 21px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('Subtotal', innerLeft + 28, totalBoxY + 42);
  ctx.textAlign = 'right';
  ctx.fillText(`KES ${cart.subtotal.toLocaleString()}`, innerRight - 28, totalBoxY + 42);
  ctx.textAlign = 'left';

  if (cart.totalDiscount > 0) {
    const badgeLabel = `SAVED KES ${cart.totalDiscount.toLocaleString()}`;
    ctx.font = '800 18px Inter, system-ui, -apple-system, sans-serif';
    const bW = ctx.measureText(badgeLabel).width + 26;
    drawRoundedRect(ctx, innerLeft + 28, totalBoxY + 58, bW, 30, 10);
    ctx.fillStyle = palette.savingsBg;
    ctx.fill();
    ctx.fillStyle = palette.savingsText;
    ctx.fillText(badgeLabel, innerLeft + 41, totalBoxY + 79);
  }

  // Horizontal rule inside total box
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(innerLeft + 28, totalBoxY + 102);
  ctx.lineTo(innerRight - 28, totalBoxY + 102);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  if (theme === 'crisp') {
    ctx.fillStyle = palette.textPrimary;
  }
  ctx.font = '700 26px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('Final Total', innerLeft + 28, totalBoxY + 148);

  ctx.textAlign = 'right';
  ctx.fillStyle = palette.totalAmountColor;
  ctx.font = '900 44px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(`KES ${cart.finalTotal.toLocaleString()}`, innerRight - 28, totalBoxY + 152);
  ctx.textAlign = 'left';

  // Footer Bar
  const footerY = padY + cardH - 36;
  ctx.fillStyle = palette.footerText;
  ctx.font = '600 18px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(
    truncateText(ctx, `Shopper: ${cart.shopperName || 'Guest Shopper'}`, 420),
    innerLeft,
    footerY
  );
  ctx.textAlign = 'right';
  ctx.fillText('Smart Cart · Verified Till Summary', innerRight, footerY);
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to export PNG image.'));
    }, 'image/png');
  });

  const safeCode = (cart.shortCode || cart.id).replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `smartcart-summary-${safeCode}.png`;

  return {
    dataUrl,
    blob,
    fileName,
    summaryText: buildCartSummaryText(options),
  };
}
