import { isRoomCode, MAX_DISPLAY_NAME_LENGTH, MAX_ROOM_NAME_LENGTH, MEDIA_PURPOSES, type ClientMessage, type MediaPurpose, type SfuRequest } from '../../../shared/protocol.js';

const MAX_ID_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** Nome de exibição: texto curto, sem quebras de linha, com espaços normalizados. */
function pickDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > MAX_DISPLAY_NAME_LENGTH) return null;
  return name;
}

function pickRoomName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length > MAX_ROOM_NAME_LENGTH) return null;
  return name;
}

function isMediaPurpose(value: unknown): value is MediaPurpose {
  return typeof value === 'string' && (MEDIA_PURPOSES as readonly string[]).includes(value);
}

/** Pedidos ao SFU: ids curtos e parâmetros WebRTC como objetos (o mediasoup valida o conteúdo). */
function pickSfuRequest(value: unknown): SfuRequest | null {
  if (!isRecord(value)) return null;
  switch (value['action']) {
    case 'capabilities':
      return { action: 'capabilities' };
    case 'create-transport':
      return value['direction'] === 'send' || value['direction'] === 'recv' ? { action: 'create-transport', direction: value['direction'] } : null;
    case 'connect-transport':
      return isShortString(value['transportId'], MAX_ID_LENGTH) && isRecord(value['dtlsParameters'])
        ? { action: 'connect-transport', transportId: value['transportId'], dtlsParameters: value['dtlsParameters'] }
        : null;
    case 'produce': {
      const { transportId, kind, rtpParameters, purpose } = value;
      if (!isShortString(transportId, MAX_ID_LENGTH) || (kind !== 'audio' && kind !== 'video') || !isRecord(rtpParameters) || !isMediaPurpose(purpose)) return null;
      return { action: 'produce', transportId, kind, rtpParameters, purpose };
    }
    case 'close-producer':
      return isShortString(value['producerId'], MAX_ID_LENGTH) ? { action: 'close-producer', producerId: value['producerId'] } : null;
    case 'consume':
      return isShortString(value['producerId'], MAX_ID_LENGTH) && isRecord(value['rtpCapabilities'])
        ? { action: 'consume', producerId: value['producerId'], rtpCapabilities: value['rtpCapabilities'] }
        : null;
    case 'resume-consumer':
      return isShortString(value['consumerId'], MAX_ID_LENGTH) ? { action: 'resume-consumer', consumerId: value['consumerId'] } : null;
    default:
      return null;
  }
}

/** Faz o parse e validação estrutural de uma mensagem crua. Retorna null se inválida. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data['type'] !== 'string') return null;

  switch (data['type']) {
    case 'leave':
      return { type: 'leave' };
    case 'join-room': {
      const roomId = data['roomId'];
      const displayName = pickDisplayName(data['displayName']);
      const roomName = pickRoomName(data['roomName']);
      if (!isRoomCode(roomId) || !displayName || roomName === null) return null;
      return roomName === undefined || roomName === '' ? { type: 'join-room', roomId, displayName } : { type: 'join-room', roomId, displayName, roomName };
    }
    case 'sfu-request': {
      const requestId = data['requestId'];
      const request = pickSfuRequest(data['request']);
      return isShortString(requestId, MAX_ID_LENGTH) && request ? { type: 'sfu-request', requestId, request } : null;
    }
    default:
      return null;
  }
}
