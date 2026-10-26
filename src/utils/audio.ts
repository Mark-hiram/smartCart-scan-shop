// Web Audio API POS scanner beep & haptic feedback simulator
export function playScanBeep(success: boolean = true) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      // Crisp 1750Hz supermarket laser scanner beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1750, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);

      // Trigger mobile vibration if supported
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    } else {
      // Warning double buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);

      if (navigator.vibrate) {
        navigator.vibrate([80, 50, 80]);
      }
    }
  } catch (e) {
    // Audio autoplay restrictions gracefully handled
  }
}
