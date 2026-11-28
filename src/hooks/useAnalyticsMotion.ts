// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { useEffect, useState, RefObject } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}

export function useInViewOnce(
  ref: RefObject<HTMLElement | null>,
  reducedMotion: boolean
): boolean {
  const [inView, setInView] = useState<boolean>(() => reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setInView(true);
      return;
    }
    if (inView) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, reducedMotion, inView]);

  return inView;
}

export function useCountUp(
  target: number,
  active: boolean,
  reducedMotion: boolean,
  durationMs = 680
): number {
  const [displayValue, setDisplayValue] = useState<number>(() =>
    reducedMotion ? target : 0
  );

  useEffect(() => {
    if (reducedMotion) {
      setDisplayValue(target);
      return;
    }
    if (!active) return;

    const startVal = 0;
    const delta = target - startVal;
    if (delta === 0) {
      setDisplayValue(target);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = startVal + delta * eased;
      setDisplayValue(Number.isInteger(target) ? Math.round(next) : Math.round(next * 10) / 10);
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayValue(target);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, active, reducedMotion, durationMs]);

  return reducedMotion ? target : displayValue;
}
