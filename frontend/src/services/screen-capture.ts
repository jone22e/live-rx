export class ScreenCaptureCancelled extends Error {
  constructor() {
    super('Compartilhamento cancelado.');
    this.name = 'ScreenCaptureCancelled';
  }
}

export const UNSUPPORTED_MESSAGE = 'Seu navegador/dispositivo não suporta compartilhamento de tela.';

export function isScreenShareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
    typeof RTCPeerConnection !== 'undefined'
  );
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 30, max: 60 },
};

/**
 * Pede ao usuário uma tela/janela/aba. Tenta com áudio de sistema e, se o navegador
 * rejeitar a combinação, repete só com vídeo. Deve ser chamada a partir de um gesto do usuário.
 */
export async function captureScreen(): Promise<MediaStream> {
  if (!isScreenShareSupported()) throw new Error(UNSUPPORTED_MESSAGE);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: VIDEO_CONSTRAINTS, audio: true });
  } catch (error) {
    if (isUserCancel(error)) throw new ScreenCaptureCancelled();
    if (!isAudioUnsupported(error)) throw error;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: VIDEO_CONSTRAINTS });
    } catch (retryError) {
      if (isUserCancel(retryError)) throw new ScreenCaptureCancelled();
      throw retryError;
    }
  }

  for (const track of stream.getVideoTracks()) {
    // Prioriza nitidez (texto) sobre fluidez: adequado a compartilhamento de tela.
    if ('contentHint' in track) track.contentHint = 'detail';
  }
  return stream;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function isUserCancel(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'AbortError';
}

function isAudioUnsupported(error: unknown): boolean {
  const name = errorName(error);
  return name === 'TypeError' || name === 'NotSupportedError' || name === 'OverconstrainedError';
}
