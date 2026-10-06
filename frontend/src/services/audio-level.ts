/**
 * Detecção de "quem está falando" por nível de áudio (RMS) com Web Audio.
 * Um único AudioContext compartilhado; é retomado no primeiro clique caso o navegador o crie suspenso.
 */
let context: AudioContext | null = null;
let resumeHookInstalled = false;

function getContext(): AudioContext {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  if (!resumeHookInstalled) {
    resumeHookInstalled = true;
    document.addEventListener('click', () => void context?.resume(), { capture: true });
  }
  return context;
}

const POLL_MS = 100;
/** RMS acima disso conta como voz (escala 0..1). */
const SPEAKING_THRESHOLD = 0.03;
/** Mantém "falando" por este tempo após a última amostra alta, evitando piscar entre palavras. */
const HOLD_MS = 500;

export class AudioLevelMonitor {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly samples: Uint8Array<ArrayBuffer>;
  private readonly timer: number;
  private speaking = false;
  private lastLoudAt = 0;

  constructor(stream: MediaStream, private readonly onChange: (speaking: boolean) => void) {
    const ctx = getContext();
    this.source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);
    this.samples = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.timer = window.setInterval(() => this.tick(), POLL_MS);
  }

  private tick(): void {
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / this.samples.length);
    const now = Date.now();
    if (rms >= SPEAKING_THRESHOLD) this.lastLoudAt = now;
    const speaking = now - this.lastLoudAt < HOLD_MS;
    if (speaking !== this.speaking) {
      this.speaking = speaking;
      this.onChange(speaking);
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.source.disconnect();
    this.analyser.disconnect();
    if (this.speaking) this.onChange(false);
  }
}

export function isAudioLevelSupported(): boolean {
  return typeof AudioContext !== 'undefined';
}
