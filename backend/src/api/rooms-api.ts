import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isRoomCode, MAX_ROOM_NAME_LENGTH, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH } from '../../../shared/protocol.js';
import type { AppConfig } from '../config.js';
import { generateRoomCode } from '../rooms/room-code.js';
import type { Room, RoomManager } from '../rooms/room-manager.js';
import type { SfuService } from '../sfu/sfu-service.js';

export interface RoomsApiDeps {
  config: AppConfig;
  rooms: RoomManager;
  sfu: SfuService;
}

/** Tamanho padrão dos códigos gerados pela API: mais longos que os do botão "Criar sala", difíceis de adivinhar. */
const API_CODE_LENGTH = 10;
const MAX_CODE_ATTEMPTS = 20;

function tokenMatches(expected: string, header: string | undefined): boolean {
  if (!header) return false;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * API REST para integração (ex.: Flexi), protegida por API_TOKEN. Salas são abertas e só vivem
 * enquanto têm gente: a API gera códigos, consulta o estado ao vivo, renomeia e encerra.
 */
export function registerRoomsApi(app: FastifyInstance, deps: RoomsApiDeps): void {
  const { config, rooms, sfu } = deps;

  const roomUrl = (code: string): string => (config.publicUrl ? `${config.publicUrl}/live/${code}` : `/live/${code}`);

  const describe = (room: Room) => {
    const screenSharers = new Set(sfu.producersOf(room.id, '').filter((p) => p.purpose === 'screen').map((p) => p.peerId));
    return {
      code: room.id,
      name: room.name,
      url: roomUrl(room.id),
      createdAt: new Date(room.createdAt).toISOString(),
      participantCount: room.members.size,
      participants: [...room.members.values()].map((m) => ({ peerId: m.id, name: m.name, sharingScreen: screenSharers.has(m.id) })),
    };
  };

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!config.apiToken) {
      await reply.code(503).send({ error: 'API desabilitada: defina API_TOKEN no servidor.' });
      return;
    }
    if (!tokenMatches(config.apiToken, request.headers.authorization)) {
      await reply.code(401).send({ error: 'Token inválido.' });
    }
  });

  app.get('/api/rooms', async () => ({
    rooms: rooms.listRooms().map((room) => {
      const { participants: _participants, ...summary } = describe(room);
      return summary;
    }),
  }));

  app.post<{ Body: { length?: unknown } | undefined }>('/api/rooms', async (request, reply) => {
    const requested = request.body?.length;
    const length = typeof requested === 'number' && Number.isInteger(requested) ? requested : API_CODE_LENGTH;
    if (length < ROOM_CODE_MIN_LENGTH || length > ROOM_CODE_MAX_LENGTH) {
      return reply.code(400).send({ error: `length deve estar entre ${ROOM_CODE_MIN_LENGTH} e ${ROOM_CODE_MAX_LENGTH}.` });
    }
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode(length);
      if (!rooms.getRoom(code)) return reply.code(201).send({ code, url: roomUrl(code) });
    }
    return reply.code(503).send({ error: 'Não foi possível gerar um código livre.' });
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    const room = rooms.getRoom(code);
    if (!room) return reply.code(404).send({ code, active: false, url: roomUrl(code) });
    return { active: true, ...describe(room) };
  });

  app.patch<{ Params: { code: string }; Body: { name?: unknown } | undefined }>('/api/rooms/:code', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    const raw = request.body?.name;
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > MAX_ROOM_NAME_LENGTH) return reply.code(400).send({ error: `name é obrigatório (até ${MAX_ROOM_NAME_LENGTH} caracteres).` });
    const room = rooms.renameRoom(code, name);
    if (!room) return reply.code(404).send({ error: 'Sala não está ativa.' });
    return describe(room);
  });

  app.delete<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    if (!rooms.closeRoomById(code)) return reply.code(404).send({ error: 'Sala não está ativa.' });
    return reply.code(204).send();
  });
}
