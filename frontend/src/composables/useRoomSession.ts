import { reactive, shallowReadonly } from 'vue';
import type { ErrorCode, ServerMessage } from '../../../shared/protocol';

/** Como o participante se identifica: nome digitado ou token de entrada emitido pela API. */
export type JoinIdentity = { displayName: string } | { joinToken: string };
import { getSignalingUrl } from '../services/config';
import { SignalingClient, type SignalingStatus } from '../services/websocket';
import { useMeeting } from './useMeeting';

export type RoomStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

interface RoomState {
  status: RoomStatus;
  message: string | null;
  /** Último erro de signaling que encerrou a tentativa (ex.: 'invalid-token'). */
  errorCode: ErrorCode | null;
  roomId: string | null;
  roomName: string;
  peerId: string | null;
  signaling: SignalingStatus;
}

const JOIN_ACK_TIMEOUT_MS = 5_000;

/** Sessão de um participante em uma sala aberta: entra pelo código, criando a sala se for o primeiro. */
export function useRoomSession() {
  const meeting = useMeeting();
  const state = reactive<RoomState>({
    status: 'idle',
    message: null,
    errorCode: null,
    roomId: null,
    roomName: '',
    peerId: null,
    signaling: 'closed',
  });

  let signaling: SignalingClient | null = null;
  let roomCode = '';
  let identity: JoinIdentity = { displayName: '' };
  /** Nome sugerido para a sala; só vale se este participante for o primeiro a entrar. */
  let requestedRoomName = '';
  let everJoined = false;
  let joinAckTimer: number | null = null;

  function clearJoinAck(): void {
    if (joinAckTimer !== null) window.clearTimeout(joinAckTimer);
    joinAckTimer = null;
  }

  function sendJoin(): void {
    const message = {
      type: 'join-room' as const,
      roomId: roomCode,
      ...identity,
      ...(requestedRoomName ? { roomName: requestedRoomName } : {}),
    };
    if (!signaling?.send(message)) return;
    // Se o socket estiver "meio aberto", o servidor não responde: força reconexão.
    clearJoinAck();
    joinAckTimer = window.setTimeout(() => {
      joinAckTimer = null;
      if (state.status === 'connecting' || state.status === 'reconnecting') signaling?.reconnect();
    }, JOIN_ACK_TIMEOUT_MS);
  }

  function handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'room-joined':
        clearJoinAck();
        state.roomId = message.roomId;
        state.roomName = message.roomName;
        state.peerId = message.peerId;
        everJoined = true;
        void meeting.start({
          myPeerId: message.peerId,
          myName: myName(),
          roomName: message.roomName,
          iceServers: message.iceServers,
          participants: message.participants,
          send: (m) => signaling?.send(m) ?? false,
        });
        state.status = 'live';
        state.message = null;
        return;
      case 'participant-joined':
      case 'participant-left':
      case 'sfu-response':
      case 'sfu-producer':
      case 'sfu-producer-closed':
        meeting.handleMessage(message);
        return;
      case 'room-updated':
        state.roomName = message.roomName;
        return;
      case 'room-closed':
        clearJoinAck();
        meeting.stop();
        meeting.stopLocalMedia();
        state.status = 'ended';
        state.message = 'A sala foi encerrada.';
        return;
      case 'error':
        clearJoinAck();
        if (message.code === 'invalid-token') {
          // Token vencido ou inválido: a página volta à pré-entrada pedindo o nome.
          meeting.stop();
          signaling?.close();
          signaling = null;
          state.status = 'idle';
          state.errorCode = message.code;
          state.message = message.message;
        } else if (message.code === 'room-full' || message.code === 'server-full' || message.code === 'sfu-unavailable') {
          meeting.stop();
          state.status = 'error';
          state.errorCode = message.code;
          state.message = message.message;
        } else {
          console.warn('[room] erro de signaling', message);
        }
        return;
    }
  }

  function handleReconnected(): void {
    // Novo socket: o servidor já removeu o peer antigo, então entra de novo na sala.
    if (state.status === 'ended' || state.status === 'error') return;
    state.status = everJoined ? 'reconnecting' : 'connecting';
    meeting.stop();
    sendJoin();
  }

  /** Nome exibido localmente: o digitado, ou o resolvido pelo servidor quando se entra por token. */
  let resolvedName = '';
  function myName(): string {
    return 'displayName' in identity ? identity.displayName : resolvedName;
  }

  async function join(code: string, who: JoinIdentity, roomName = '', nameFromToken = ''): Promise<void> {
    leave();
    roomCode = code;
    identity = who;
    resolvedName = nameFromToken;
    requestedRoomName = roomName;
    everJoined = false;
    state.status = 'connecting';
    state.message = null;
    state.errorCode = null;

    const client = new SignalingClient(getSignalingUrl(), {
      onMessage: handleMessage,
      onStatus: (status) => {
        state.signaling = status;
        if (status === 'reconnecting' && state.status === 'live') state.status = 'reconnecting';
      },
      onReconnected: handleReconnected,
    });
    signaling = client;
    try {
      await client.connect();
    } catch {
      if (signaling !== client) return;
      state.status = 'error';
      state.message = 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
      return;
    }
    if (signaling !== client) return;
    sendJoin();
  }

  /** Nova tentativa manual após falha. */
  function retry(): void {
    void join(roomCode, identity, requestedRoomName, resolvedName);
  }

  /** Best-effort ao fechar a aba: avisa o servidor sem esperar o heartbeat detectar a queda. */
  function notifyLeave(): void {
    if (state.status === 'live') signaling?.send({ type: 'leave' });
  }

  function leave(): void {
    clearJoinAck();
    meeting.stop();
    signaling?.send({ type: 'leave' });
    signaling?.close();
    signaling = null;
    state.status = 'idle';
    state.message = null;
  }

  return { state: shallowReadonly(state), join, retry, leave, notifyLeave };
}
