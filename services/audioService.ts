class AudioService {
  private audioCtx: AudioContext | null = null;
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;

  private initCtx() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: 'interactive',
      });
    }
  }

  private async ensureContextReady() {
    this.initCtx();
    if (!this.audioCtx) return null;

    if (this.audioCtx.state !== 'running') {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        // iOS Safari can fail to resume interrupted contexts; recreate it.
        this.audioCtx = null;
        this.initCtx();
        if (!this.audioCtx) return null;
        try {
          await this.audioCtx.resume();
        } catch {
          return null;
        }
      }
    }

    return this.audioCtx;
  }

  public async unlock() {
    const ctx = await this.ensureContextReady();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.00001, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.02);
  }

  public async enableBackgroundMode() {
    const ctx = await this.ensureContextReady();
    if (!ctx) return;

    if (this.keepAliveOsc) return;

    this.keepAliveOsc = ctx.createOscillator();
    this.keepAliveGain = ctx.createGain();

    this.keepAliveOsc.type = 'sine';
    this.keepAliveOsc.frequency.value = 20;
    this.keepAliveGain.gain.value = 0.00001;

    this.keepAliveOsc.connect(this.keepAliveGain);
    this.keepAliveGain.connect(ctx.destination);
    this.keepAliveOsc.start();
  }

  public disableBackgroundMode() {
    if (this.keepAliveOsc) {
      try {
        this.keepAliveOsc.stop();
        this.keepAliveOsc.disconnect();
      } catch (e) {}
      this.keepAliveOsc = null;
    }
    if (this.keepAliveGain) {
      this.keepAliveGain.disconnect();
      this.keepAliveGain = null;
    }
  }

  /**
   * Short beep for countdown seconds.
   */
  public async playTick() {
    const ctx = await this.ensureContextReady();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Main alert ding for interval transitions.
   */
  public async playDing() {
    const ctx = await this.ensureContextReady();
    if (!ctx) return;

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(890, now + 0.1);

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.6, now + 0.005);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1760, now);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.005);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain1);
    osc2.connect(gain2);

    gain1.connect(ctx.destination);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    osc1.stop(now + 1.0);
    osc2.stop(now + 1.0);
  }
}

export const audioService = new AudioService();
