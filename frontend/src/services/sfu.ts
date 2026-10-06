import { Device, type types as ms } from 'mediasoup-client';
import type { ClientMessage, IceServer, MediaPurpose, ServerMessage, SfuProducerInfo, SfuRequest } from '../../../shared/protocol';
import type { NetworkCallbacks, RemoteMedia } from './media-network';
import type { StatsSource } from './stats';

export interface NetworkEntry {
  id: string;
  pc: StatsSource;
}

export interface SfuCallbacks extends NetworkCallbacks {
  send(message: ClientMessage): boolean;
}

interface RemoteEntry {
  camera: MediaStream;
  screen: MediaStream;
  consumers: Map<string, { consumer: ms.Consumer; purpose: MediaPurpose }>;
}

interface TransportParams {
  id: string;
  iceParameters: ms.IceParameters;
  iceCandidates: ms.IceCandidate[];
  dtlsParameters: ms.DtlsParameters;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Tela precisa de texto legível; câmera é modesta porque vai para todos. */
const ENCODINGS: Partial<Record<MediaPurpose, RTCRtpEncodingParameters[]>> = {
  camera: [{ maxBitrate: 600_000 }],
  screen: [{ maxBitrate: 6_000_000 }],
};

/** Adapta um Transport do mediasoup-client ao que o painel de debug lê. */
function statsSourceOf(transport: ms.Transport): StatsSource {
  return {
    getStats: () => transport.getStats(),
    get connectionState() {
      return transport.connectionState;
    },
    iceConnectionState: 'n/a',
    signalingState: 'n/a',
  };
}

/**
 * Topologia via servidor (mediasoup): um transport de envio e um de recepção por participante.
 * Cada mídia local vira um producer; cada producer remoto vira um consumer.
 */
export class SfuNetwork {
  private readonly device = new Device();
  private sendTransport: ms.Transport | null = null;
  private sendTransportPromise: Promise<ms.Transport> | null = null;
  private recvTransport: ms.Transport | null = null;
  private readonly producers = new Map<MediaPurpose, ms.Producer>();
  private readonly remotes = new Map<string, RemoteEntry>();
  private readonly participants = new Set<string>();
  private readonly localTracks = new Map<MediaPurpose, MediaStreamTrack>();
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private ready: Promise<void> | null = null;
  private closed = false;
  private requestSeq = 0;

  constructor(
    private readonly myPeerId: string,
    private readonly iceServers: IceServer[],
    private readonly callbacks: SfuCallbacks,
  ) {}

  /** Carrega as capacidades do roteador, abre o transport de recepção e consome o que já existe. */
  init(): Promise<void> {
    this.ready ??= this.initialize();
    return this.ready;
  }

  private async initialize(): Promise<void> {
    const caps = (await this.request({ action: 'capabilities' })) as { rtpCapabilities: ms.RtpCapabilities; producers: SfuProducerInfo[] };
    await this.device.load({ routerRtpCapabilities: caps.rtpCapabilities });
    this.recvTransport = await this.createTransport('recv');
    // Producers que já existiam antes de entrarmos. Sem esperar o init (estamos dentro dele).
    for (const producer of caps.producers) await this.consumeNow(producer);
  }

  entries(): NetworkEntry[] {
    const list: NetworkEntry[] = [];
    if (this.sendTransport) list.push({ id: 'sfu:send', pc: statsSourceOf(this.sendTransport) });
    if (this.recvTransport) list.push({ id: 'sfu:recv', pc: statsSourceOf(this.recvTransport) });
    return list;
  }

  async setParticipants(peerIds: string[]): Promise<void> {
    const next = new Set(peerIds);
    for (const id of [...this.remotes.keys()]) {
      if (!next.has(id)) this.removeParticipant(id);
    }
    this.participants.clear();
    for (const id of peerIds) await this.addParticipant(id);
  }

  async addParticipant(peerId: string): Promise<void> {
    if (peerId !== this.myPeerId) this.participants.add(peerId);
  }

  removeParticipant(peerId: string): void {
    this.participants.delete(peerId);
    const entry = this.remotes.get(peerId);
    if (!entry) return;
    for (const { consumer } of entry.consumers.values()) consumer.close();
    this.remotes.delete(peerId);
    this.callbacks.onRemoteMedia(peerId, null);
  }

  async setLocalTrack(purpose: MediaPurpose, track: MediaStreamTrack | null): Promise<void> {
    if (this.closed) return;
    if (!track) {
      this.localTracks.delete(purpose);
      const producer = this.producers.get(purpose);
      if (!producer) return;
      this.producers.delete(purpose);
      producer.close();
      await this.request({ action: 'close-producer', producerId: producer.id }).catch(() => undefined);
      return;
    }
    this.localTracks.set(purpose, track);
    await this.init();
    if (this.closed) return;
    const existing = this.producers.get(purpose);
    if (existing && !existing.closed) {
      await existing.replaceTrack({ track });
      return;
    }
    // Memoizado como promise: câmera e microfone podem ser publicados ao mesmo tempo.
    this.sendTransportPromise ??= this.createTransport('send').then((transport) => {
      this.sendTransport = transport;
      return transport;
    });
    const sendTransport = await this.sendTransportPromise;
    if (this.closed) return;
    const encodings = ENCODINGS[purpose];
    const producer = await sendTransport.produce({
      track,
      ...(encodings ? { encodings } : {}),
      codecOptions: track.kind === 'video' ? { videoGoogleStartBitrate: 1000 } : { opusStereo: true, opusDtx: true },
      appData: { purpose },
    });
    if (this.closed || this.localTracks.get(purpose) !== track) {
      producer.close();
      return;
    }
    this.producers.set(purpose, producer);
    producer.on('transportclose', () => this.producers.delete(purpose));
  }

  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'sfu-response': {
        const waiting = this.pending.get(message.requestId);
        if (!waiting) return;
        this.pending.delete(message.requestId);
        window.clearTimeout(waiting.timer);
        if (message.ok) waiting.resolve(message.data);
        else waiting.reject(new Error(message.error));
        return;
      }
      case 'sfu-producer':
        void this.consume(message.producer);
        return;
      case 'sfu-producer-closed':
        this.dropConsumer(message.peerId, message.producerId);
        return;
      default:
        return;
    }
  }

  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) {
      window.clearTimeout(waiting.timer);
      waiting.reject(new Error('Conexão com o SFU encerrada.'));
    }
    this.pending.clear();
    for (const producer of this.producers.values()) producer.close();
    this.producers.clear();
    for (const peerId of [...this.remotes.keys()]) this.removeParticipant(peerId);
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.sendTransportPromise = null;
    this.recvTransport = null;
    this.participants.clear();
  }

  private request(request: SfuRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Conexão com o SFU encerrada.'));
        return;
      }
      this.requestSeq += 1;
      const requestId = `q${this.requestSeq}`;
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('O servidor de mídia não respondeu.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      if (!this.callbacks.send({ type: 'sfu-request', requestId, request })) {
        this.pending.delete(requestId);
        window.clearTimeout(timer);
        reject(new Error('Sinalização indisponível.'));
      }
    });
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<ms.Transport> {
    const params = (await this.request({ action: 'create-transport', direction })) as TransportParams;
    const options = { ...params, iceServers: this.iceServers };
    const transport = direction === 'send' ? this.device.createSendTransport(options) : this.device.createRecvTransport(options);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request({ action: 'connect-transport', transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((error: unknown) => errback(error instanceof Error ? error : new Error(String(error))));
    });
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.request({ action: 'produce', transportId: transport.id, kind, rtpParameters, purpose: appData['purpose'] as MediaPurpose })
          .then((data) => callback({ id: (data as { id: string }).id }))
          .catch((error: unknown) => errback(error instanceof Error ? error : new Error(String(error))));
      });
    }
    transport.on('connectionstatechange', (state) => {
      this.callbacks.onLinkState(state);
      if (state === 'failed') this.callbacks.onLinkFailed();
    });
    return transport;
  }

  private async consume(info: SfuProducerInfo): Promise<void> {
    await this.init().catch(() => undefined);
    await this.consumeNow(info);
  }

  private async consumeNow(info: SfuProducerInfo): Promise<void> {
    if (info.peerId === this.myPeerId) return;
    try {
      if (this.closed || !this.recvTransport) return;
      const data = (await this.request({ action: 'consume', producerId: info.producerId, rtpCapabilities: this.device.rtpCapabilities })) as {
        id: string;
        producerId: string;
        kind: 'audio' | 'video';
        rtpParameters: ms.RtpParameters;
      };
      if (this.closed) return;
      const consumer = await this.recvTransport.consume({ id: data.id, producerId: data.producerId, kind: data.kind, rtpParameters: data.rtpParameters });
      const entry = this.ensureRemote(info.peerId);
      entry.consumers.get(info.producerId)?.consumer.close();
      entry.consumers.set(info.producerId, { consumer, purpose: info.purpose });
      this.streamFor(entry, info.purpose).addTrack(consumer.track);
      consumer.on('transportclose', () => this.dropConsumer(info.peerId, info.producerId));
      await this.request({ action: 'resume-consumer', consumerId: consumer.id });
      this.publish(info.peerId);
    } catch (error) {
      console.warn('[sfu] falha ao consumir producer', error);
    }
  }

  private dropConsumer(peerId: string, producerId: string): void {
    const entry = this.remotes.get(peerId);
    const found = entry?.consumers.get(producerId);
    if (!entry || !found) return;
    entry.consumers.delete(producerId);
    found.consumer.close();
    this.streamFor(entry, found.purpose).removeTrack(found.consumer.track);
    this.publish(peerId);
  }

  private ensureRemote(peerId: string): RemoteEntry {
    let entry = this.remotes.get(peerId);
    if (!entry) {
      entry = { camera: new MediaStream(), screen: new MediaStream(), consumers: new Map() };
      this.remotes.set(peerId, entry);
    }
    return entry;
  }

  private streamFor(entry: RemoteEntry, purpose: MediaPurpose): MediaStream {
    return purpose === 'screen' || purpose === 'screen-audio' ? entry.screen : entry.camera;
  }

  private publish(peerId: string): void {
    const entry = this.remotes.get(peerId);
    if (!entry) return;
    const has = (purpose: MediaPurpose) => [...entry.consumers.values()].some((c) => c.purpose === purpose && !c.consumer.closed);
    const media: RemoteMedia = {
      peerId,
      camera: entry.camera,
      screen: entry.screen,
      hasVideo: has('camera'),
      hasAudio: has('mic'),
      hasScreen: has('screen'),
    };
    this.callbacks.onRemoteMedia(peerId, media);
  }
}
