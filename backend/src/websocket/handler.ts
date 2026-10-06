import type { FastifyInstance } from 'fastify';
import type { RawData } from 'ws';
import { MAX_MESSAGE_BYTES, type ClientMessage, type ErrorCode } from '../../../shared/protocol.js';
import type { AppConfig } from '../config.js';
import type { JoinTokenStore } from '../rooms/join-tokens.js';
import type { RoomManager } from '../rooms/room-manager.js';
import { SfuError, type SfuService } from '../sfu/sfu-service.js';
import { Peer } from './peer.js';
import { parseClientMessage } from './validate.js';

export interface SignalingDeps {
  config: AppConfig;
  rooms: RoomManager;
  sfu: SfuService;
  joinTokens: JoinTokenStore;
}

/**
 * Registra a rota /ws. A sala de cada socket é atribuída pelo servidor no join;
 * pedidos ao SFU só valem dentro dela.
 */
export function registerSignaling(app: FastifyInstance, deps: SignalingDeps): void {
  const { config, rooms, sfu, joinTokens } = deps;
  const connected = new Set<Peer>();

  const heartbeat = setInterval(() => {
    for (const peer of connected) {
      if (!peer.alive) {
        app.log.warn({ peerId: peer.id }, 'heartbeat timeout, terminating socket');
        peer.terminate();
        continue;
      }
      peer.alive = false;
      peer.ping();
    }
  }, config.heartbeatIntervalMs);

  app.addHook('onClose', () => {
    clearInterval(heartbeat);
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    if (config.allowedOrigins && (!origin || !config.allowedOrigins.includes(origin))) {
      app.log.warn({ origin }, 'websocket origin rejected');
      socket.close(1008, 'origin not allowed');
      return;
    }

    const peer = new Peer(socket);
    connected.add(peer);
    app.log.debug({ peerId: peer.id }, 'socket connected');

    socket.on('pong', () => {
      peer.alive = true;
    });

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        sendError(peer, 'invalid-message', 'Mensagens binárias não são aceitas.');
        return;
      }
      const text = rawDataToString(data);
      if (text.length > MAX_MESSAGE_BYTES) {
        sendError(peer, 'invalid-message', 'Mensagem muito grande.');
        return;
      }
      const message = parseClientMessage(text);
      if (!message) {
        sendError(peer, 'invalid-message', 'Mensagem inválida.');
        return;
      }
      void handleMessage(peer, message);
    });

    socket.on('close', () => {
      connected.delete(peer);
      detachSfu(peer);
      rooms.leaveRoom(peer);
      app.log.debug({ peerId: peer.id }, 'socket closed');
    });

    socket.on('error', (error: Error) => {
      app.log.warn({ peerId: peer.id, err: error }, 'socket error');
    });
  });

  async function handleMessage(peer: Peer, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'join-room': {
        if (peer.roomId) return sendError(peer, 'already-in-room', 'Você já está em uma sala.');
        if (!sfu.available) return sendError(peer, 'sfu-unavailable', 'Servidor de mídia indisponível. Tente novamente em instantes.');
        if (message.joinToken !== undefined) {
          const identity = joinTokens.resolve(message.joinToken, message.roomId);
          if (!identity) return sendError(peer, 'invalid-token', 'Link de entrada inválido ou expirado. Informe seu nome para entrar.');
          peer.name = identity.name;
          peer.recorder = identity.recorder;
        } else if (message.displayName) {
          peer.name = message.displayName;
          peer.recorder = false;
        } else {
          return sendError(peer, 'invalid-message', 'Nome não informado.');
        }
        const result = rooms.joinRoom(message.roomId, peer, message.roomName);
        if (!result.ok) return sendError(peer, result.code, result.message);
        peer.send({
          type: 'room-joined',
          roomId: result.room.id,
          roomName: result.room.name,
          peerId: peer.id,
          participants: rooms.participantsOf(result.room, peer.id),
          iceServers: config.iceServers,
        });
        return;
      }
      case 'sfu-request': {
        const room = peer.roomId ? rooms.getRoom(peer.roomId) : undefined;
        if (!room) return sendError(peer, 'not-in-room', 'Você não está em uma sala.');
        if (!sfu.available) {
          peer.send({ type: 'sfu-response', requestId: message.requestId, ok: false, error: 'Servidor de mídia indisponível.' });
          return;
        }
        try {
          const result = await sfu.handleRequest(room.id, peer.id, message.request);
          peer.send({ type: 'sfu-response', requestId: message.requestId, ok: true, data: result.data });
          if (result.newProducer) rooms.broadcast(room, peer.id, { type: 'sfu-producer', producer: result.newProducer });
          if (result.closedProducerId) rooms.broadcast(room, peer.id, { type: 'sfu-producer-closed', peerId: peer.id, producerId: result.closedProducerId });
        } catch (error) {
          const text = error instanceof SfuError ? error.message : 'Falha no servidor de mídia.';
          if (!(error instanceof SfuError)) app.log.warn({ err: error, peerId: peer.id }, 'sfu request failed');
          peer.send({ type: 'sfu-response', requestId: message.requestId, ok: false, error: text });
        }
        return;
      }
      case 'leave': {
        if (!peer.roomId) return sendError(peer, 'not-in-room', 'Você não está em uma sala.');
        detachSfu(peer);
        rooms.leaveRoom(peer);
        return;
      }
    }
  }

  /** Fecha transports/producers do participante no SFU e avisa os outros membros da sala. */
  function detachSfu(peer: Peer): void {
    if (!peer.roomId) return;
    const room = rooms.getRoom(peer.roomId);
    const closed = sfu.removePeer(peer.roomId, peer.id);
    if (!room) return;
    for (const producerId of closed) rooms.broadcast(room, peer.id, { type: 'sfu-producer-closed', peerId: peer.id, producerId });
  }

  function sendError(peer: Peer, code: ErrorCode, message: string): void {
    peer.send({ type: 'error', code, message });
  }
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
