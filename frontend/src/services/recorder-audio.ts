/**
 * Captura o áudio da reunião para o ScreenRx, de dentro da página: mistura o áudio de todos os
 * participantes remotos num único MediaStream (Web Audio) e o grava com MediaRecorder, entregando os
 * pedaços pela ponte `window.screenrxMeetAudio`. Existe porque o macOS não entrega o áudio de uma
 * janela do Electron à captura de tela por janela; capturar aqui dá o áudio exato da reunião, sem
 * misturar sons de outros apps.
 */
export function isRecorderAudioBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && window.screenrxMeetAudio !== undefined && typeof MediaRecorder !== 'undefined';
}

const TIMESLICE_MS = 1000;
const AUDIO_BITS_PER_SECOND = 128_000;

function pickMimeType(): string {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported(type)) return type;
  return '';
}

export class RecorderAudioCapture {
  private context: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private readonly sources = new Map<string, MediaStreamAudioSourceNode>();
  /** Envio dos pedaços em ordem: cada um espera o anterior terminar de ser lido. */
  private pending: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | null = null;

  constructor(private readonly bridge: ScreenrxMeetAudioBridge) {}

  get running(): boolean {
    return this.recorder !== null;
  }

  start(): void {
    if (this.recorder) return;
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(destination.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    recorder.addEventListener('start', () => this.bridge.begin(Date.now(), recorder.mimeType));
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return;
      this.pending = this.pending.then(async () => {
        this.bridge.chunk(await event.data.arrayBuffer());
      });
    });
    this.context = context;
    this.destination = destination;
    this.recorder = recorder;
    void context.resume();
    recorder.start(TIMESLICE_MS);
    this.bridge.onStopRequest(() => {
      void this.stop().then(() => this.bridge.end());
    });
  }

  /** Conecta as faixas de áudio remotas atuais e solta as que acabaram (chamado a cada mudança de mídia). */
  setTracks(tracks: MediaStreamTrack[]): void {
    const context = this.context;
    const destination = this.destination;
    if (!context || !destination) return;
    const live = new Map(tracks.filter((t) => t.kind === 'audio' && t.readyState === 'live').map((t) => [t.id, t]));
    for (const [id, source] of this.sources) {
      if (live.has(id)) continue;
      source.disconnect();
      this.sources.delete(id);
    }
    for (const [id, track] of live) {
      if (this.sources.has(id)) continue;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination);
      this.sources.set(id, source);
    }
  }

  /** Encerra a gravação e espera o último pedaço ser entregue. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      const recorder = this.recorder;
      if (recorder && recorder.state !== 'inactive') {
        const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
        recorder.stop();
        await stopped;
      }
      await this.pending;
      for (const source of this.sources.values()) source.disconnect();
      this.sources.clear();
      await this.context?.close().catch(() => undefined);
      this.context = null;
      this.destination = null;
      this.recorder = null;
    })();
    return this.stopping;
  }
}
