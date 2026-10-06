import { DEFAULT_ROOM_NAME, type ErrorCode, type Participant, type ServerMessage } from '../../../shared/protocol.js';

/** O que o gerenciador precisa saber de um peer; a camada WebSocket implementa isso. */
export interface PeerLike {
  id: string;
  name: string;
  roomId: string | null;
  send(message: ServerMessage): void;
}

export interface Room {
  id: string;
  name: string;
  members: Map<string, PeerLike>;
  /** Fechamento agendado quando a sala esvazia (tolerância para reconexões). */
  emptyTimer: NodeJS.Timeout | null;
  createdAt: number;
}

export type JoinResult = { ok: true; room: Room } | { ok: false; code: ErrorCode; message: string };

export interface RoomManagerOptions {
  maxRooms: number;
  maxParticipantsPerRoom: number;
  /** Tempo que uma sala vazia fica viva antes de ser removida. */
  emptyRoomGraceMs: number;
  onRoomClosed?: (roomId: string) => void;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

/**
 * Salas abertas, só em memória: qualquer código válido passa a existir no primeiro join e é
 * removida pouco depois de esvaziar. Não há dono nem persistência; quem guarda códigos é quem monta os links.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly options: RoomManagerOptions) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get participantCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.members.size;
    return total;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }

  renameRoom(roomId: string, name: string): Room | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    room.name = name;
    this.broadcast(room, '', { type: 'room-updated', roomName: name });
    return room;
  }

  /** Encerra uma sala ativa avisando quem está dentro (API ou shutdown). */
  closeRoomById(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    for (const member of room.members.values()) {
      member.roomId = null;
      member.send({ type: 'room-closed' });
    }
    room.members.clear();
    this.closeRoom(room);
    return true;
  }

  /** Entra na sala do código informado, criando-a se não existir (o nome só vale na criação). */
  joinRoom(roomId: string, peer: PeerLike, roomName?: string): JoinResult {
    let room = this.rooms.get(roomId);
    if (!room) {
      if (this.rooms.size >= this.options.maxRooms) {
        return { ok: false, code: 'server-full', message: 'Limite de salas simultâneas atingido.' };
      }
      room = {
        id: roomId,
        name: roomName && roomName.length > 0 ? roomName : DEFAULT_ROOM_NAME,
        members: new Map(),
        emptyTimer: null,
        createdAt: Date.now(),
      };
      this.rooms.set(roomId, room);
      this.options.log.info({ roomId, name: room.name }, 'room created');
    }
    if (room.members.size >= this.options.maxParticipantsPerRoom) {
      return { ok: false, code: 'room-full', message: 'Esta sala atingiu o limite de participantes.' };
    }
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    room.members.set(peer.id, peer);
    peer.roomId = room.id;
    this.broadcast(room, peer.id, { type: 'participant-joined', peerId: peer.id, name: peer.name, participantCount: room.members.size });
    this.options.log.info({ roomId: room.id, peerId: peer.id, members: room.members.size }, 'participant joined');
    return { ok: true, room };
  }

  /** Saída explícita ou queda de socket: avisa os outros e agenda o fechamento se a sala esvaziou. */
  leaveRoom(peer: PeerLike): void {
    const room = peer.roomId ? this.rooms.get(peer.roomId) : undefined;
    peer.roomId = null;
    if (!room || !room.members.delete(peer.id)) return;
    this.broadcast(room, peer.id, { type: 'participant-left', peerId: peer.id, participantCount: room.members.size });
    this.options.log.info({ roomId: room.id, peerId: peer.id, members: room.members.size }, 'participant left');
    if (room.members.size === 0) {
      room.emptyTimer = setTimeout(() => {
        room.emptyTimer = null;
        if (room.members.size === 0) this.closeRoom(room);
      }, this.options.emptyRoomGraceMs);
    }
  }

  /** Participantes da sala exceto `exceptPeerId`. */
  participantsOf(room: Room, exceptPeerId: string): Participant[] {
    const list: Participant[] = [];
    for (const member of room.members.values()) {
      if (member.id !== exceptPeerId) list.push({ peerId: member.id, name: member.name });
    }
    return list;
  }

  broadcast(room: Room, exceptPeerId: string, message: ServerMessage): void {
    for (const member of room.members.values()) {
      if (member.id !== exceptPeerId) member.send(message);
    }
  }

  closeAll(): void {
    for (const roomId of [...this.rooms.keys()]) this.closeRoomById(roomId);
  }

  private closeRoom(room: Room): void {
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    this.rooms.delete(room.id);
    this.options.onRoomClosed?.(room.id);
    this.options.log.info({ roomId: room.id }, 'room closed');
  }
}
