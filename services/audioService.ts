const SAMPLE_RATE = 22050;

function createToneDataUrl(frequency: number, durationSeconds: number, volume = 0.35): string {
  const sampleCount = Math.max(1, Math.floor(SAMPLE_RATE * durationSeconds));
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.max(0, 1 - t / durationSeconds);
    const value = Math.sin(2 * Math.PI * frequency * t) * envelope * volume;
    view.setInt16(44 + i * 2, value * 32767, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

const POOL_SIZE = 3;
const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

class AudioService {
  private audioCtx: AudioContext | null = null;
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  private tickPool: HTMLAudioElement[];
  private dingPool: HTMLAudioElement[];
  private tickIdx = 0;
  private dingIdx = 0;
  private silentAudio: HTMLAudioElement;
  private silentPlaying = false;

  constructor() {
    const tickSrc = createToneDataUrl(660, 0.12);
    const dingSrc = createToneDataUrl(880, 0.8);

    this.tickPool = Array.from({ length: POOL_SIZE }, () =>
      this.createAudioEl(tickSrc),
    );
    this.dingPool = Array.from({ length: POOL_SIZE }, () =>
      this.createAudioEl(dingSrc),
    );

    // A silent 1-second WAV used as a keep-alive loop on mobile to prevent
    // the OS from suspending the audio session when the screen locks.
    this.silentAudio = this.createAudioEl(createToneDataUrl(1, 1, 0));
    this.silentAudio.loop = true;
    this.silentAudio.volume = 0.01;
  }

  private createAudioEl(src: string): HTMLAudioElement {
    const a = new Audio(src);
    a.preload = 'auto';
    a.playsInline = true;
    a.setAttribute('playsinline', 'true');
    a.setAttribute('webkit-playsinline', 'true');
    return a;
  }

  private initCtx(): void {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: 'interactive',
      });
    }
  }

  private async ensureContextReady(): Promise<AudioContext | null> {
    this.initCtx();
    if (!this.audioCtx) {
      return null;
    }

    if (this.audioCtx.state !== 'running') {
      try {
        await this.audioCtx.resume();
      } catch {
        this.audioCtx = null;
        this.initCtx();
        if (!this.audioCtx) {
          return null;
        }

        try {
          await this.audioCtx.resume();
        } catch {
          return null;
        }
      }
    }

    return this.audioCtx;
  }

  /** Prime every HTMLAudioElement with a muted play() so the browser allows
   *  unmuted playback later (required by mobile autoplay policies). */
  private async primeFallbackAudio(): Promise<void> {
    const all = [...this.tickPool, ...this.dingPool, this.silentAudio];
    for (const a of all) {
      try {
        a.muted = true;
        a.currentTime = 0;
        await a.play();
        a.pause();
        a.currentTime = 0;
      } catch {
        /* noop */
      }
      a.muted = false;
    }
  }

  /** Fire-and-forget version safe to call from synchronous gesture handlers. */
  private primeFallbackAudioFromGesture(): void {
    const all = [...this.tickPool, ...this.dingPool, this.silentAudio];
    for (const a of all) {
      a.muted = true;
      a.currentTime = 0;
      void a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          a.muted = false;
        });
    }
  }

  /** Play one element from the pool, rotating to avoid reuse conflicts. */
  private playFromPool(
    pool: HTMLAudioElement[],
    idxKey: 'tickIdx' | 'dingIdx',
    volume: number,
  ): void {
    const a = pool[this[idxKey]];
    this[idxKey] = (this[idxKey] + 1) % pool.length;
    a.pause();
    a.currentTime = 0;
    a.volume = volume;
    a.play().catch(() => {});
  }

  /* ── Public API ──────────────────────────────────────────── */

  public async unlock(): Promise<void> {
    const ctx = await this.ensureContextReady();
    if (ctx) {
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

    try {
      await this.primeFallbackAudio();
    } catch {
      // noop
    }
  }

  public unlockFromGesture(): void {
    this.initCtx();
    this.audioCtx?.resume().catch(() => {});

    if (this.audioCtx) {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.00001, this.audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.02);
    }

    this.primeFallbackAudioFromGesture();
  }

  public async recoverForActiveSession(): Promise<void> {
    await this.unlock();
    await this.enableBackgroundMode();
  }

  public async enableBackgroundMode(): Promise<void> {
    // 1. Web Audio keep-alive oscillator (inaudible 30 Hz tone)
    const ctx = await this.ensureContextReady();
    if (ctx && !this.keepAliveOsc) {
      this.keepAliveOsc = ctx.createOscillator();
      this.keepAliveGain = ctx.createGain();
      this.keepAliveOsc.type = 'sine';
      this.keepAliveOsc.frequency.value = 30;
      this.keepAliveGain.gain.value = 0.00002;
      this.keepAliveOsc.connect(this.keepAliveGain);
      this.keepAliveGain.connect(ctx.destination);
      this.keepAliveOsc.start();
    }

    // 2. HTMLAudioElement silent loop – keeps the mobile audio session
    //    alive so the OS doesn't suspend sound when the screen locks.
    if (!this.silentPlaying) {
      this.silentPlaying = true;
      this.silentAudio.play().catch(() => {
        this.silentPlaying = false;
      });
    }
  }

  public disableBackgroundMode(): void {
    if (this.keepAliveOsc) {
      try {
        this.keepAliveOsc.stop();
        this.keepAliveOsc.disconnect();
      } catch {
        // noop
      }
      this.keepAliveOsc = null;
    }

    if (this.keepAliveGain) {
      this.keepAliveGain.disconnect();
      this.keepAliveGain = null;
    }

    if (this.silentPlaying) {
      this.silentAudio.pause();
      this.silentAudio.currentTime = 0;
      this.silentPlaying = false;
    }
  }

  public async playTick(): Promise<void> {
    const ctx = await this.ensureContextReady();

    // On mobile, always play the HTMLAudioElement alongside Web Audio.
    // Mobile browsers may silently suspend the AudioContext, so the
    // HTMLAudioElement acts as a reliable fallback that keeps working.
    if (!ctx || IS_MOBILE) {
      this.playFromPool(this.tickPool, 'tickIdx', 0.7);
    }
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

  public async playDing(): Promise<void> {
    const ctx = await this.ensureContextReady();

    // Always fire HTMLAudioElement on mobile for reliability.
    if (!ctx || IS_MOBILE) {
      this.playFromPool(this.dingPool, 'dingIdx', 1);
    }
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
