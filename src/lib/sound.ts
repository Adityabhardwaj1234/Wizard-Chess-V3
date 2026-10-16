/**
 * Cathedral Sound Mixer
 *
 * Restraint-focused WebAudio synthesiser with master volume (0–100), mute toggle,
 * and per-category sound controls (move, capture, check, gameover).
 * Zero external audio assets; respects user gesture autoplay policies.
 */

export type Cue = 'move' | 'capture' | 'check' | 'select' | 'illegal' | 'gameover' | 'promote';

interface Tone {
  freq: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
  sweepTo?: number;
}

export interface SoundConfig {
  enabled: boolean;
  volume: number; // 0 .. 100
  move: boolean;
  capture: boolean;
  check: boolean;
  gameover: boolean;
}

const CUES: Record<Cue, Tone[]> = {
  select: [{ freq: 520, durationMs: 45, type: 'sine', gain: 0.04 }],
  move: [{ freq: 310, durationMs: 85, type: 'triangle', gain: 0.08, sweepTo: 240 }],
  capture: [
    { freq: 195, durationMs: 110, type: 'triangle', gain: 0.11, sweepTo: 105 },
    { freq: 410, durationMs: 65, type: 'sine', gain: 0.05 }
  ],
  promote: [
    { freq: 440, durationMs: 95, type: 'triangle', gain: 0.07 },
    { freq: 554, durationMs: 95, type: 'triangle', gain: 0.07 },
    { freq: 659, durationMs: 150, type: 'sine', gain: 0.08 }
  ],
  check: [
    { freq: 660, durationMs: 80, type: 'sine', gain: 0.08 },
    { freq: 880, durationMs: 120, type: 'triangle', gain: 0.07 }
  ],
  illegal: [{ freq: 150, durationMs: 120, type: 'sawtooth', gain: 0.05, sweepTo: 110 }],
  gameover: [
    { freq: 392, durationMs: 160, type: 'sine', gain: 0.08 },
    { freq: 330, durationMs: 180, type: 'sine', gain: 0.07 },
    { freq: 262, durationMs: 320, type: 'triangle', gain: 0.08 }
  ]
};

let context: AudioContext | null = null;
let soundConfig: SoundConfig = {
  enabled: true,
  volume: 75,
  move: true,
  capture: true,
  check: true,
  gameover: true
};

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch (_err) {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function setSoundEnabled(value: boolean): void {
  soundConfig.enabled = value;
}

export function configureSound(patch: Partial<SoundConfig>): void {
  soundConfig = { ...soundConfig, ...patch };
}

export function playCue(cue: Cue): void {
  if (!soundConfig.enabled || soundConfig.volume <= 0) return;
  if (cue === 'move' && !soundConfig.move) return;
  if (cue === 'capture' && !soundConfig.capture) return;
  if (cue === 'check' && !soundConfig.check) return;
  if (cue === 'gameover' && !soundConfig.gameover) return;

  const ctx = getContext();
  if (!ctx) return;

  const volumeScale = Math.max(0, Math.min(1, soundConfig.volume / 100));
  let offset = 0;
  for (const tone of CUES[cue]) {
    const startAt = ctx.currentTime + offset;
    const endAt = startAt + tone.durationMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, startAt);
    if (tone.sweepTo) osc.frequency.exponentialRampToValueAtTime(tone.sweepTo, endAt);

    const peakGain = Math.max(0.0002, tone.gain * volumeScale);
    amp.gain.setValueAtTime(0.0001, startAt);
    amp.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, endAt);

    osc.connect(amp).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);

    offset += tone.durationMs / 1000;
  }
}