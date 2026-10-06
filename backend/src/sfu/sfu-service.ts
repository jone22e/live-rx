import * as mediasoup from 'mediasoup';
import type { Consumer, Producer, Router, WebRtcTransport, Worker } from 'mediasoup/types';
import type { MediaPurpose, SfuProducerInfo, SfuRequest } from '../../../shared/protocol.js';
import type { AppConfig } from '../config.js';

interface SfuPeer {
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface SfuRoom {
  router: Router;
  peers: Map<string, SfuPeer>;
}

export class SfuError extends Error {}

const MEDIA_CODECS: NonNullable<mediasoup.types.RouterOptions['mediaCodecs']> = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

/**
 * SFU com mediasoup: um Router por sala, transports/producers/consumers por participante.
 * Só repassa pacotes já cifrados pelo navegador de origem; não decodifica nada.
 */
export class SfuService {
  private worker: Worker | null = null;
  private readonly rooms = new Map<string, SfuRoom>();

  constructor(
    private readonly config: AppConfig['sfu'],
    private readonly log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void },
  ) {}

  get available(): boolean {
    return this.worker !== null;
  }

  async start(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: this.config.rtcMinPort,
      rtcMaxPort: this.config.rtcMaxPort,
    });
    this.worker.on('died', (error) => {
      this.log.error({ err: error }, 'mediasoup worker morreu; SFU indisponível até reiniciar');
      this.worker = null;
      for (const roomId of [...this.rooms.keys()]) this.closeRoom(roomId);
    });
    this.log.info({ ports: `${this.config.rtcMinPort}-${this.config.rtcMaxPort}`, announcedIp: this.config.announcedIp }, 'mediasoup worker started');
  }

  async stop(): Promise<void> {
    for (const roomId of [...this.rooms.keys()]) this.closeRoom(roomId);
    this.worker?.close();
    this.worker = null;
  }

  /** Producers ativos da sala (para quem entra ou migra consumir o que já existe). */
  producersOf(roomId: string, exceptPeerId: string): SfuProducerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const list: SfuProducerInfo[] = [];
    for (const [peerId, peer] of room.peers) {
      if (peerId === exceptPeerId) continue;
      for (const producer of peer.producers.values()) {
        list.push({ peerId, producerId: producer.id, purpose: producer.appData['purpose'] as MediaPurpose, kind: producer.kind });
      }
    }
    return list;
  }

  async handleRequest(roomId: string, peerId: string, request: SfuRequest): Promise<{ data: unknown; newProducer?: SfuProducerInfo; closedProducerId?: string }> {
    const room = await this.ensureRoom(roomId);
    const peer = this.ensurePeer(room, peerId);

    switch (request.action) {
      case 'capabilities':
        return { data: { rtpCapabilities: room.router.rtpCapabilities, producers: this.producersOf(roomId, peerId) } };

      case 'create-transport': {
        const transport = await room.router.createWebRtcTransport({
          listenInfos: [
            { protocol: 'udp', ip: this.config.listenIp, announcedAddress: this.config.announcedIp },
            { protocol: 'tcp', ip: this.config.listenIp, announcedAddress: this.config.announcedIp },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          initialAvailableOutgoingBitrate: 1_000_000,
          appData: { direction: request.direction },
        });
        peer.transports.set(transport.id, transport);
        transport.on('dtlsstatechange', (state) => {
          if (state === 'closed' || state === 'failed') transport.close();
        });
        return {
          data: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        };
      }

      case 'connect-transport': {
        const transport = peer.transports.get(request.transportId);
        if (!transport) throw new SfuError('Transport não encontrado.');
        await transport.connect({ dtlsParameters: request.dtlsParameters as mediasoup.types.DtlsParameters });
        return { data: {} };
      }

      case 'produce': {
        const transport = peer.transports.get(request.transportId);
        if (!transport) throw new SfuError('Transport não encontrado.');
        // Um producer por finalidade: substituir fecha o anterior.
        for (const existing of peer.producers.values()) {
          if (existing.appData['purpose'] === request.purpose) {
            existing.close();
            peer.producers.delete(existing.id);
          }
        }
        const producer = await transport.produce({
          kind: request.kind,
          rtpParameters: request.rtpParameters as mediasoup.types.RtpParameters,
          appData: { purpose: request.purpose, peerId },
        });
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => peer.producers.delete(producer.id));
        return {
          data: { id: producer.id },
          newProducer: { peerId, producerId: producer.id, purpose: request.purpose, kind: producer.kind },
        };
      }

      case 'close-producer': {
        const producer = peer.producers.get(request.producerId);
        if (!producer) return { data: {} };
        producer.close();
        peer.producers.delete(producer.id);
        return { data: {}, closedProducerId: producer.id };
      }

      case 'consume': {
        const rtpCapabilities = request.rtpCapabilities as mediasoup.types.RtpCapabilities;
        const owner = [...room.peers.values()].find((p) => p.producers.has(request.producerId));
        const producer = owner?.producers.get(request.producerId);
        if (!producer || !room.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
          throw new SfuError('Não é possível consumir este producer.');
        }
        const transport = [...peer.transports.values()].find((t) => t.appData['direction'] === 'recv');
        if (!transport) throw new SfuError('Transport de recepção não criado.');
        const consumer = await transport.consume({ producerId: producer.id, rtpCapabilities, paused: true });
        peer.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
        consumer.on('producerclose', () => peer.consumers.delete(consumer.id));
        return {
          data: {
            id: consumer.id,
            producerId: producer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            peerId: producer.appData['peerId'],
            purpose: producer.appData['purpose'],
          },
        };
      }

      case 'resume-consumer': {
        const consumer = peer.consumers.get(request.consumerId);
        if (!consumer) throw new SfuError('Consumer não encontrado.');
        await consumer.resume();
        return { data: {} };
      }
    }
  }

  /** Participante saiu: fecha tudo dele e devolve os producers fechados para avisar os outros. */
  removePeer(roomId: string, peerId: string): string[] {
    const room = this.rooms.get(roomId);
    const peer = room?.peers.get(peerId);
    if (!room || !peer) return [];
    const closed = [...peer.producers.keys()];
    for (const transport of peer.transports.values()) transport.close();
    room.peers.delete(peerId);
    return closed;
  }

  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const peer of room.peers.values()) {
      for (const transport of peer.transports.values()) transport.close();
    }
    room.router.close();
    this.rooms.delete(roomId);
    this.log.info({ roomId }, 'sfu room closed');
  }

  private async ensureRoom(roomId: string): Promise<SfuRoom> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    if (!this.worker) throw new SfuError('SFU indisponível.');
    const router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    const room: SfuRoom = { router, peers: new Map() };
    this.rooms.set(roomId, room);
    this.log.info({ roomId }, 'sfu room created');
    return room;
  }

  private ensurePeer(room: SfuRoom, peerId: string): SfuPeer {
    let peer = room.peers.get(peerId);
    if (!peer) {
      peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
      room.peers.set(peerId, peer);
    }
    return peer;
  }
}
