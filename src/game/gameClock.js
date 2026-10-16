/**
 * Precision Chess Clock Controller
 * Uses high-resolution performance.now() deltas to avoid timer drift on delayed UI frames.
 */

export const TIME_CONTROL_PRESETS = {
  untimed: { id: 'untimed', label: 'Untimed Sanctuary', initialMs: 0, incrementMs: 0 },
  bullet_1_0: { id: 'bullet_1_0', label: 'Bullet 1+0', initialMs: 60 * 1000, incrementMs: 0 },
  blitz_3_2: { id: 'blitz_3_2', label: 'Blitz 3+2', initialMs: 3 * 60 * 1000, incrementMs: 2000 },
  blitz_5_3: { id: 'blitz_5_3', label: 'Blitz 5+3', initialMs: 5 * 60 * 1000, incrementMs: 3000 },
  rapid_10_0: { id: 'rapid_10_0', label: 'Rapid 10+0', initialMs: 10 * 60 * 1000, incrementMs: 0 },
  classical_15_10: { id: 'classical_15_10', label: 'Classical 15+10', initialMs: 15 * 60 * 1000, incrementMs: 10000 }
};

export class GameClock {
  constructor(presetId = 'untimed', onTick = null, onTimeout = null) {
    this.onTick = onTick;
    this.onTimeout = onTimeout;
    this.intervalId = null;
    this.configure(presetId);
  }

  configure(presetId) {
    this.stop();
    const preset = TIME_CONTROL_PRESETS[presetId] || TIME_CONTROL_PRESETS.untimed;
    this.presetId = preset.id;
    this.enabled = preset.initialMs > 0;
    this.initialMs = preset.initialMs;
    this.incrementMs = preset.incrementMs;
    this.remainingMs = {
      w: preset.initialMs,
      b: preset.initialMs
    };
    this.activeSide = null;
    this.lastTimestamp = 0;
    this.timedOutSide = null;
  }

  start(side) {
    if (!this.enabled || this.timedOutSide) return;
    this.updateElapsed();
    this.activeSide = side;
    this.lastTimestamp = performance.now();
    if (!this.intervalId) {
      this.intervalId = setInterval(() => this.tick(), 100);
    }
  }

  switchTurn(completedSide) {
    if (!this.enabled || this.timedOutSide) return;
    this.updateElapsed();
    if (this.remainingMs[completedSide] > 0) {
      this.remainingMs[completedSide] += this.incrementMs;
    }
    this.activeSide = completedSide === 'w' ? 'b' : 'w';
    this.lastTimestamp = performance.now();
    if (this.onTick) this.onTick(this.getState());
  }

  updateElapsed() {
    if (!this.enabled || !this.activeSide || !this.lastTimestamp) return;
    const now = performance.now();
    const delta = Math.max(0, now - this.lastTimestamp);
    this.lastTimestamp = now;
    this.remainingMs[this.activeSide] = Math.max(0, this.remainingMs[this.activeSide] - delta);
    if (this.remainingMs[this.activeSide] <= 0 && !this.timedOutSide) {
      this.timedOutSide = this.activeSide;
      this.stop();
      if (this.onTimeout) this.onTimeout(this.timedOutSide);
    }
  }

  tick() {
    this.updateElapsed();
    if (this.onTick) this.onTick(this.getState());
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.activeSide = null;
    this.lastTimestamp = 0;
  }

  getState() {
    return {
      enabled: this.enabled,
      presetId: this.presetId,
      w: Math.ceil(this.remainingMs.w),
      b: Math.ceil(this.remainingMs.b),
      activeSide: this.activeSide,
      timedOutSide: this.timedOutSide
    };
  }

  static formatMs(ms) {
    if (ms <= 0) return '0:00.0';
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins === 0 && totalSeconds < 20) {
      const tenths = Math.floor((ms % 1000) / 100);
      return `0:${secs.toString().padStart(2, '0')}.${tenths}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
