import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { MAX_MESSAGE_BYTES } from '../../shared/protocol.js';
import { loadConfig } from './config.js';
import { RoomManager } from './rooms/room-manager.js';
import { SfuService } from './sfu/sfu-service.js';
import { registerRoomsApi } from './api/rooms-api.js';
import { JoinTokenStore } from './rooms/join-tokens.js';
import { registerSignaling } from './websocket/handler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({ logger: { level: config.logLevel } });

  // Toda a mídia passa pelo SFU (mediasoup): sem worker não há reunião, então falhar aqui é fatal.
  const sfu = new SfuService(config.sfu, app.log);
  await sfu.start();

  const rooms = new RoomManager({
    maxRooms: config.maxRooms,
    maxParticipantsPerRoom: config.maxParticipantsPerRoom,
    emptyRoomGraceMs: config.emptyRoomGraceMs,
    onRoomClosed: (roomId) => sfu.closeRoom(roomId),
    log: app.log,
  });

  await app.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
  });

  app.get('/health', async () => ({
    ok: true,
    rooms: rooms.roomCount,
    participants: rooms.participantCount,
    sfu: sfu.available,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  const joinTokens = new JoinTokenStore(config.joinTokenTtlMs);
  registerSignaling(app, { config, rooms, sfu, joinTokens });
  registerRoomsApi(app, { config, rooms, sfu, joinTokens });
  app.log.info({ api: config.apiToken ? 'enabled' : 'disabled (API_TOKEN not set)' }, 'rooms api');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    rooms.closeAll();
    joinTokens.stop();
    await sfu.stop();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ iceServers: config.iceServers.map((s) => s.urls) }, 'ice servers configured');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
