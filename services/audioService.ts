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

class AudioService {
  private audioCtx: AudioContext | null;
  private keepAliveOsc: OscillatorNode | null;
  private keepAliveGain: GainNode | null;
  private tickFallback: HTMLAudioElement;
  private dingFallback: HTMLAudioElement;

  constructor() {
    this.audioCtx = null;
    this.keepAliveOsc = null;
    this.keepAliveGain = null;
    this.tickFallback = this.createFallbackAudio(createToneDataUrl(660, 0.12));
    this.dingFallback = this.createFallbackAudio(createToneDataUrl(880, 0.8));
  }

  private createFallbackAudio(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    return audio;
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

  private async primeFallbackAudio(): Promise<void> {
    const audios = [this.tickFallback, this.dingFallback];
    for (const audio of audios) {
      audio.muted = true;
      audio.currentTime = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }
  }

  private primeFallbackAudioFromGesture(): void {
    const audios = [this.tickFallback, this.dingFallback];
    for (const audio of audios) {
      audio.muted = true;
      audio.currentTime = 0;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    }
  }

  private playFallback(type: 'tick' | 'ding'): void {
    const audio = type === 'tick' ? this.tickFallback : this.dingFallback;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = type === 'tick' ? 0.7 : 1;
    audio.play().catch(() => {});
  }

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
    const ctx = await this.ensureContextReady();
    if (!ctx || this.keepAliveOsc) {
      return;
    }

    this.keepAliveOsc = ctx.createOscillator();
    this.keepAliveGain = ctx.createGain();
    this.keepAliveOsc.type = 'sine';
    this.keepAliveOsc.frequency.value = 30;
    this.keepAliveGain.gain.value = 0.00002;
    this.keepAliveOsc.connect(this.keepAliveGain);
    this.keepAliveGain.connect(ctx.destination);
    this.keepAliveOsc.start();
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
  }

  public async playTick(): Promise<void> {
    const ctx = await this.ensureContextReady();
    if (!ctx) {
      this.playFallback('tick');
      return;
    }

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
    if (!ctx) {
      this.playFallback('ding');
      return;
    }

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
