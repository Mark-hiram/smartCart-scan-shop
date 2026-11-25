// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { EnrichedProduct } from '../types';

export type VoiceActionType = 'add' | 'remove' | 'price_check';

export interface ParsedVoiceCommand {
  action: VoiceActionType;
  quantity: number;
  itemQuery: string;
  rawTranscript: string;
}

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => any) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEventLike) => any) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEventLike) => any) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  moja: 1,
  two: 2,
  couple: 2,
  mbili: 2,
  three: 3,
  tatu: 3,
  four: 4,
  nne: 4,
  five: 5,
  tano: 5,
  six: 6,
  sita: 6,
  seven: 7,
  saba: 7,
  eight: 8,
  nane: 8,
  nine: 9,
  tisa: 9,
  ten: 10,
  kumi: 10,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVoiceCommand(transcript: string): ParsedVoiceCommand | null {
  const rawTranscript = transcript.trim();
  if (!rawTranscript) return null;

  let text = normalizeText(rawTranscript);
  if (!text) return null;

  let action: VoiceActionType = 'add';

  if (
    /^(remove|delete|drop|take out|ondoa|toa)\b/.test(text) ||
    /\b(from my cart|from cart|from the cart|out of cart|kutoka toroli)\b/.test(text)
  ) {
    action = 'remove';
  } else if (/^(check price|price check|how much is|what is the price|bei ya|angalia bei)\b/.test(text)) {
    action = 'price_check';
  }

  // Strip common leading/trailing command phrases
  text = text
    .replace(
      /^(please\s+|can you\s+|could you\s+|i want to\s+|i d like to\s+|naomba\s+|tafadhali\s+)*/i,
      ''
    )
    .replace(
      /^(add|put|place|scan|buy|get|grab|remove|delete|drop|take out|check price of|check price for|check price|price check on|price check|how much is|what is the price of|ongeza|weka|ondoa|toa|angalia bei ya|bei ya)\s+/i,
      ''
    )
    .replace(
      /\s+(to my cart|to the cart|to cart|in my cart|in the cart|in cart|into my cart|into the cart|into cart|from my cart|from the cart|from cart|out of my cart|out of the cart|out of cart|kwenye toroli langu|kwenye toroli|kutoka toroli|please)$/i,
      ''
    )
    .trim();

  // Extract leading quantity if present (e.g. "2 bottles of milk", "three bread")
  let quantity = 1;
  const digitMatch = text.match(/^(\d+)\s+(.+)$/);
  if (digitMatch) {
    const parsedQty = parseInt(digitMatch[1], 10);
    if (Number.isFinite(parsedQty) && parsedQty >= 1) {
      quantity = Math.min(50, parsedQty);
      text = digitMatch[2].trim();
    }
  } else {
    const wordMatch = text.match(/^([a-z]+)\s+(.+)$/);
    if (wordMatch && NUMBER_WORDS[wordMatch[1]] !== undefined) {
      quantity = NUMBER_WORDS[wordMatch[1]];
      text = wordMatch[2].trim();
    }
  }

  // Strip container/unit words and filler articles
  text = text
    .replace(
      /^(x\s+|times\s+|pieces of\s+|piece of\s+|bottles of\s+|bottle of\s+|packs of\s+|pack of\s+|packets of\s+|packet of\s+|cartons of\s+|carton of\s+|loaves of\s+|loaf of\s+|boxes of\s+|box of\s+|cans of\s+|can of\s+|bags of\s+|bag of\s+|jars of\s+|jar of\s+|tins of\s+|tin of\s+)/i,
      ''
    )
    .replace(/^(the|a|an|some|of)\s+/i, '')
    .trim();

  if (!text) return null;

  return {
    action,
    quantity,
    itemQuery: text,
    rawTranscript,
  };
}

export function findBestMatchingProduct(
  query: string,
  products: EnrichedProduct[]
): EnrichedProduct | null {
  if (!query || products.length === 0) return null;

  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const compactDigits = normalizedQuery.replace(/\s+/g, '');
  const queryTokens = normalizedQuery.split(' ').filter((tok) => tok.length >= 2 || /^\d+$/.test(tok));
  if (queryTokens.length === 0) return null;

  let bestProduct: EnrichedProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    if (product.barcode === compactDigits) {
      return product;
    }

    const normName = normalizeText(product.name);
    const coreName = normName.replace(/\b\d+(?:\.\d+)?\s*(?:ml|l|g|kg|pcs|pack|litres?|grams?|kilograms?)\b/g, '').replace(/\s+/g, ' ').trim();
    const normCategory = normalizeText(product.category || '');
    const nameWords = normName.split(' ').filter(Boolean);

    if (normName === normalizedQuery || coreName === normalizedQuery) {
      return product;
    }

    let score = 0;

    if (coreName.endsWith(` ${normalizedQuery}`)) {
      score += 130;
    } else if (normName.startsWith(normalizedQuery)) {
      score += 105;
    } else if (normName.includes(normalizedQuery)) {
      score += 90;
    }

    let matchedTokens = 0;
    for (const qToken of queryTokens) {
      if (nameWords.includes(qToken)) {
        matchedTokens += 1;
        score += 65;
      } else if (nameWords.some((w) => w.startsWith(qToken) || (qToken.length >= 4 && w.includes(qToken)))) {
        matchedTokens += 1;
        score += 42;
      } else if (normCategory && normCategory.includes(qToken)) {
        score += 15;
      }
    }

    if (matchedTokens === 0) continue;

    // Bonus for covering all query tokens and tighter product name match
    if (matchedTokens === queryTokens.length) {
      score += 40;
    }
    score -= Math.min(20, Math.max(0, nameWords.length - queryTokens.length) * 2);

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  return bestScore >= 40 ? bestProduct : null;
}
