/**
 * Protocolo de signaling compartilhado entre frontend e backend.
 * Apenas tipos e helpers puros: sem dependência de DOM nem de Node.
 */

export const ROOM_CODE_MIN_LENGTH = 6;
export const ROOM_CODE_MAX_LENGTH = 12;
/** Tamanho dos códigos gerados pelo botão "Criar sala"; links do Flexi podem usar até o máximo. */
export const ROOM_CODE_LENGTH = ROOM_CODE_MIN_LENGTH;

/** Letras maiúsculas e dígitos sem caracteres ambíguos (O/0, I/1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_MIN_LENGTH},${ROOM_CODE_MAX_LENGTH}}$`);

/** Remove espaços/sinais e coloca em maiúsculas (não valida). */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
}

/** Limite de tamanho de uma mensagem WebSocket (parâmetros WebRTC têm poucos KB). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Espelho estrutural de RTCIceServer (o backend não tem lib DOM). Entregue aos transports do SFU. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Finalidade de cada mídia publicada no SFU: câmera, microfone, tela ou áudio da tela. */
export type MediaPurpose = 'camera' | 'mic' | 'screen' | 'screen-audio';
export const MEDIA_PURPOSES: readonly MediaPurpose[] = ['camera', 'mic', 'screen', 'screen-audio'];

/** Pedidos ao SFU (mediasoup) feitos pelo navegador; cada um recebe um 'sfu-response' com o mesmo requestId. */
export type SfuRequest =
  | { action: 'capabilities' }
  | { action: 'create-transport'; direction: 'send' | 'recv' }
  | { action: 'connect-transport'; transportId: string; dtlsParameters: object }
  | { action: 'produce'; transportId: string; kind: 'audio' | 'video'; rtpParameters: object; purpose: MediaPurpose }
  | { action: 'close-producer'; producerId: string }
  | { action: 'consume'; producerId: string; rtpCapabilities: object }
  | { action: 'resume-consumer'; consumerId: string };

export interface SfuProducerInfo {
  peerId: string;
  producerId: string;
  purpose: MediaPurpose;
  kind: 'audio' | 'video';
}

export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_ROOM_NAME_LENGTH = 60;
export const DEFAULT_ROOM_NAME = 'Reunião';

export interface Participant {
  peerId: string;
  name: string;
  /** Participante que só grava a reunião (entrou com token de gravador): sem câmera nem microfone. */
  recorder?: boolean;
}

/**
 * Mensagens enviadas pelo navegador ao servidor. Salas são abertas: qualquer código válido
 * passa a existir no primeiro join (que pode dar o nome da reunião) e some quando esvazia.
 */
export type ClientMessage =
  /** Entra com o nome digitado ou com um token de entrada emitido pela API (o servidor resolve o nome). */
  | { type: 'join-room'; roomId: string; displayName?: string; joinToken?: string; roomName?: string }
  | { type: 'sfu-request'; requestId: string; request: SfuRequest }
  | { type: 'leave' };

export type ErrorCode = 'invalid-message' | 'invalid-token' | 'room-full' | 'server-full' | 'not-in-room' | 'already-in-room' | 'sfu-unavailable';

/** Mensagens enviadas pelo servidor ao navegador. */
export type ServerMessage =
  | {
      type: 'room-joined';
      roomId: string;
      roomName: string;
      peerId: string;
      /** Demais participantes já na sala. */
      participants: Participant[];
      iceServers: IceServer[];
    }
  /** Enviado a todos os outros membros da sala. */
  | { type: 'participant-joined'; peerId: string; name: string; participantCount: number; recorder?: boolean }
  | { type: 'participant-left'; peerId: string; participantCount: number }
  | { type: 'sfu-response'; requestId: string; ok: true; data: unknown }
  | { type: 'sfu-response'; requestId: string; ok: false; error: string }
  | { type: 'sfu-producer'; producer: SfuProducerInfo }
  | { type: 'sfu-producer-closed'; peerId: string; producerId: string }
  /** Sala renomeada pela API. */
  | { type: 'room-updated'; roomName: string }
  /** Sala encerrada pela API ou pelo servidor: deixa de existir. */
  | { type: 'room-closed' }
  | { type: 'error'; code: ErrorCode; message: string };
