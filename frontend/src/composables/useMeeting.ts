import { computed, markRaw, reactive, shallowReadonly } from 'vue';
import type { ClientMessage, IceServer, MediaPurpose, Participant, ServerMessage } from '../../../shared/protocol';
import { AudioLevelMonitor, isAudioLevelSupported } from '../services/audio-level';
import type { RemoteMedia } from '../services/media-network';
import { SfuNetwork } from '../services/sfu';
import { captureScreen, isScreenShareSupported, ScreenCaptureCancelled } from '../services/screen-capture';

export const MEDIA_SERVER_FAILURE_MESSAGE = 'Não foi possível conectar ao servidor de mídia.';

const LOCAL_PRESENTER = 'me';

export interface MeetingStartOptions {
  myPeerId: string;
  myName: string;
  roomName: string;
  iceServers: IceServer[];
  participants: Participant[];
  send(message: ClientMessage): boolean;
}

export interface Presentation {
  stream: MediaStream;
  label: string;
  isLocal: boolean;
}

interface MeetingState {
  active: boolean;
  myPeerId: string | null;
  myName: string;
  roomName: string;
  /** Momento em que este participante entrou (para o cronômetro). */
  joinedAt: number | null;
  cameraOn: boolean;
  micOn: boolean;
  screenOn: boolean;
  busy: boolean;
  /** Câmera + microfone locais (tracks entram/saem conforme os toggles). */
  localStream: MediaStream;
  /** Tela local compartilhada. */
  localScreen: MediaStream;
  remotes: RemoteMedia[];
  /** Outros participantes na sala (sem contar este). */
  participants: Participant[];
  participantCount: number;
  /** Estado da conexão com o servidor de mídia. */
  mediaServer: RTCPeerConnectionState;
  /** Quem está apresentando, na ordem em que começou ('me' = este participante). */
  presenters: string[];
  /** Quem está falando agora, na ordem em que começou ('me' = este participante). */
  speaking: string[];
  notice: string | null;
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  /** Dispositivos escolhidos ('' = padrão do navegador). */
  cameraId: string;
  microphoneId: string;
}

const state = reactive<MeetingState>({
  active: false,
  myPeerId: null,
  myName: '',
  roomName: '',
  joinedAt: null,
  cameraOn: false,
  micOn: false,
  screenOn: false,
  busy: false,
  localStream: markRaw(new MediaStream()),
  localScreen: markRaw(new MediaStream()),
  remotes: [],
  participants: [],
  participantCount: 0,
  mediaServer: 'new',
  presenters: [],
  speaking: [],
  notice: null,
  cameras: [],
  microphones: [],
  cameraId: '',
  microphoneId: '',
});

/* Monitores de nível de áudio por participante ('me' = microfone local), chaveados pelas tracks observadas. */
const monitors = new Map<string, { key: string; monitor: AudioLevelMonitor }>();

function setSpeaking(id: string, speaking: boolean): void {
  const without = state.speaking.filter((s) => s !== id);
  state.speaking = speaking ? [...without, id] : without;
}

function monitorStream(id: string, stream: MediaStream | null): void {
  if (!isAudioLevelSupported()) return;
  const tracks = stream?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
  const key = tracks.map((t) => t.id).join(',');
  const current = monitors.get(id);
  if (current && current.key === key) return;
  current?.monitor.stop();
  monitors.delete(id);
  setSpeaking(id, false);
  if (!stream || tracks.length === 0) return;
  try {
    monitors.set(id, { key, monitor: new AudioLevelMonitor(stream, (speaking) => setSpeaking(id, speaking)) });
  } catch (error) {
    console.warn('[meeting] monitor de áudio indisponível', error);
  }
}

function stopMonitors(): void {
  for (const { monitor } of monitors.values()) monitor.stop();
  monitors.clear();
  state.speaking = [];
}

let network: SfuNetwork | null = null;
let send: ((message: ClientMessage) => boolean) | null = null;

/**
 * Conecta ao servidor de mídia e publica a mídia local. A rede é atribuída antes do init,
 * porque as respostas do SFU chegam por handleMessage e precisam encontrá-la.
 */
async function activateNetwork(myPeerId: string, iceServers: IceServer[], participantIds: string[]): Promise<void> {
  network?.closeAll();
  const next = new SfuNetwork(myPeerId, iceServers, {
    send: (message) => send?.(message) ?? false,
    onRemoteMedia: (peerId, media) => updateRemote(peerId, media),
    onLinkState: (linkState) => {
      state.mediaServer = linkState;
    },
    onLinkFailed: () => {
      state.notice = MEDIA_SERVER_FAILURE_MESSAGE;
    },
  });
  network = next;
  try {
    await next.init();
    if (network !== next) return;
    await next.setParticipants(participantIds);
    for (const [purpose, track] of localTrackEntries()) {
      if (network !== next) return;
      await next.setLocalTrack(purpose, track);
    }
  } catch (error) {
    console.error('[meeting] falha ao conectar ao servidor de mídia', error);
    if (network === next) state.notice = MEDIA_SERVER_FAILURE_MESSAGE;
  }
}

function nameOf(peerId: string): string {
  return state.participants.find((p) => p.peerId === peerId)?.name ?? 'Participante';
}

function setPresenting(id: string, presenting: boolean): void {
  const without = state.presenters.filter((p) => p !== id);
  state.presenters = presenting ? [...without, id] : without;
}

function updateRemote(peerId: string, media: RemoteMedia | null): void {
  const others = state.remotes.filter((r) => r.peerId !== peerId);
  state.remotes = media ? [...others, { ...media, camera: markRaw(media.camera), screen: markRaw(media.screen) }] : others;
  setPresenting(peerId, media?.hasScreen ?? false);
  monitorStream(peerId, media?.hasAudio ? media.camera : null);
}

function syncCount(): void {
  state.participantCount = state.participants.length;
}

function upsertParticipant(participant: Participant): void {
  state.participants = [...state.participants.filter((p) => p.peerId !== participant.peerId), participant];
  syncCount();
}

function dropParticipant(peerId: string): void {
  state.participants = state.participants.filter((p) => p.peerId !== peerId);
  setPresenting(peerId, false);
  syncCount();
}

/** Chamado pela sessão (host ou viewer) assim que a sala é conhecida. Reinicia a rede se já existia. */
async function start(options: MeetingStartOptions): Promise<void> {
  network?.closeAll();
  network = null;
  send = options.send;
  state.myPeerId = options.myPeerId;
  state.myName = options.myName;
  state.roomName = options.roomName;
  state.joinedAt ??= Date.now();
  state.remotes = [];
  state.mediaServer = 'new';
  state.presenters = state.screenOn ? [LOCAL_PRESENTER] : [];
  stopMonitors();
  monitorStream(LOCAL_PRESENTER, state.micOn ? state.localStream : null);
  state.participants = options.participants;
  syncCount();
  state.active = true;
  await activateNetwork(options.myPeerId, options.iceServers, options.participants.map((p) => p.peerId));
}

function localTrackEntries(): Array<[MediaPurpose, MediaStreamTrack]> {
  const entries: Array<[MediaPurpose, MediaStreamTrack]> = [];
  for (const track of state.localStream.getTracks()) entries.push([track.kind === 'video' ? 'camera' : 'mic', track]);
  for (const track of state.localScreen.getTracks()) entries.push([track.kind === 'video' ? 'screen' : 'screen-audio', track]);
  return entries;
}

async function setParticipants(participants: Participant[]): Promise<void> {
  state.participants = participants;
  syncCount();
  await network?.setParticipants(participants.map((p) => p.peerId));
}

/** Encaminha mensagens de sala e do SFU. Ignora o resto. */
function handleMessage(message: ServerMessage): void {
  if (!state.active) return;
  switch (message.type) {
    case 'participant-joined':
      upsertParticipant({ peerId: message.peerId, name: message.name });
      void network?.addParticipant(message.peerId);
      return;
    case 'participant-left':
      dropParticipant(message.peerId);
      network?.removeParticipant(message.peerId);
      return;
    case 'sfu-response':
    case 'sfu-producer':
    case 'sfu-producer-closed':
      network?.handleMessage(message);
      return;
    default:
      return;
  }
}

/** Fecha as conexões. Mantém câmera/microfone/tela locais para uma eventual nova entrada. */
function stop(): void {
  network?.closeAll();
  network = null;
  send = null;
  state.remotes = [];
  state.participants = [];
  state.participantCount = 0;
  state.mediaServer = 'new';
  state.presenters = state.screenOn ? [LOCAL_PRESENTER] : [];
  stopMonitors();
  state.active = false;
}

function stopLocalMedia(): void {
  for (const track of state.localStream.getTracks()) {
    track.stop();
    state.localStream.removeTrack(track);
  }
  stopScreenTracks();
  state.cameraOn = false;
  state.micOn = false;
  monitorStream(LOCAL_PRESENTER, null);
  state.joinedAt = null;
}

function constraintsFor(purpose: 'camera' | 'mic'): MediaStreamConstraints {
  if (purpose === 'camera') {
    const video: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
    if (state.cameraId) video.deviceId = { exact: state.cameraId };
    else video.facingMode = 'user';
    return { video };
  }
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (state.microphoneId) audio.deviceId = { exact: state.microphoneId };
  return { audio };
}

/** Lista câmeras e microfones (rótulos só aparecem depois de uma permissão concedida). */
async function refreshDevices(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.cameras = devices.filter((d) => d.kind === 'videoinput');
    state.microphones = devices.filter((d) => d.kind === 'audioinput');
  } catch (error) {
    console.warn('[meeting] enumerateDevices falhou', error);
  }
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices());
}

/** Troca o dispositivo e, se a mídia estiver ligada, reabre com o novo. */
async function selectDevice(purpose: 'camera' | 'mic', deviceId: string): Promise<void> {
  if (purpose === 'camera') state.cameraId = deviceId;
  else state.microphoneId = deviceId;
  const on = purpose === 'camera' ? state.cameraOn : state.micOn;
  if (!on) return;
  await toggleDevice(purpose);
  await toggleDevice(purpose);
}

async function toggleDevice(purpose: 'camera' | 'mic'): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.notice = null;
  const kind = purpose === 'camera' ? 'video' : 'audio';
  try {
    const current = state.localStream.getTracks().find((t) => t.kind === kind);
    if (current) {
      current.stop();
      state.localStream.removeTrack(current);
      await network?.setLocalTrack(purpose, null);
      setDeviceFlag(purpose, false);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraintsFor(purpose));
    } catch (error) {
      state.notice = describeMediaError(purpose, error);
      return;
    }
    void refreshDevices();
    const track = stream.getTracks()[0];
    if (!track) return;
    track.addEventListener('ended', () => {
      // Dispositivo removido ou permissão revogada.
      state.localStream.removeTrack(track);
      setDeviceFlag(purpose, false);
      void network?.setLocalTrack(purpose, null);
    });
    state.localStream.addTrack(track);
    await network?.setLocalTrack(purpose, track);
    setDeviceFlag(purpose, true);
  } finally {
    state.busy = false;
  }
}

function setDeviceFlag(purpose: 'camera' | 'mic', on: boolean): void {
  if (purpose === 'camera') {
    state.cameraOn = on;
    return;
  }
  state.micOn = on;
  monitorStream(LOCAL_PRESENTER, on ? state.localStream : null);
}

function stopScreenTracks(): void {
  for (const track of state.localScreen.getTracks()) {
    track.stop();
    state.localScreen.removeTrack(track);
  }
  state.screenOn = false;
  setPresenting(LOCAL_PRESENTER, false);
}

async function stopScreen(): Promise<void> {
  stopScreenTracks();
  await network?.setLocalTrack('screen', null);
  await network?.setLocalTrack('screen-audio', null);
}

/** Liga/desliga o compartilhamento de tela. Deve ser chamado a partir de um clique (exigência do getDisplayMedia). */
async function toggleScreen(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.notice = null;
  try {
    if (state.screenOn) {
      await stopScreen();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await captureScreen();
    } catch (error) {
      state.notice = error instanceof ScreenCaptureCancelled ? null : error instanceof Error ? error.message : 'Não foi possível capturar a tela.';
      return;
    }
    for (const track of stream.getTracks()) state.localScreen.addTrack(track);
    state.screenOn = true;
    setPresenting(LOCAL_PRESENTER, true);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      // Usuário parou pelo botão do próprio navegador.
      void stopScreen();
    });
    for (const track of stream.getTracks()) {
      await network?.setLocalTrack(track.kind === 'video' ? 'screen' : 'screen-audio', track);
    }
  } finally {
    state.busy = false;
  }
}

function describeMediaError(purpose: 'camera' | 'mic', error: unknown): string {
  const device = purpose === 'camera' ? 'câmera' : 'microfone';
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return `Permissão para usar a ${device} negada.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `Nenhuma ${device} encontrada.`;
  if (name === 'NotReadableError') return `A ${device} está em uso por outro aplicativo.`;
  return `Não foi possível acessar a ${device}.`;
}

const screenSupported = isScreenShareSupported();

/** Tela em destaque: o apresentador mais recente (remoto ou local). */
const presentation = computed<Presentation | null>(() => {
  const id = state.presenters[state.presenters.length - 1];
  if (!id) return null;
  if (id === LOCAL_PRESENTER) return { stream: state.localScreen, label: 'Você está apresentando', isLocal: true };
  const remote = state.remotes.find((r) => r.peerId === id);
  if (!remote) return null;
  return { stream: remote.screen, label: `${nameOf(id)} está apresentando`, isLocal: false };
});

export interface ActiveSpeaker {
  id: string;
  name: string;
  isLocal: boolean;
}

/** Quem começou a falar por último (para o destaque flutuante). */
const activeSpeaker = computed<ActiveSpeaker | null>(() => {
  const id = state.speaking[state.speaking.length - 1];
  if (!id) return null;
  if (id === LOCAL_PRESENTER) return { id, name: state.myName, isLocal: true };
  const participant = state.participants.find((p) => p.peerId === id);
  if (!participant) return null;
  return { id, name: participant.name, isLocal: false };
});

export function useMeeting() {
  return {
    state: shallowReadonly(state),
    screenSupported,
    presentation,
    activeSpeaker,
    start,
    setParticipants,
    handleMessage,
    stop,
    stopLocalMedia,
    toggleCamera: () => toggleDevice('camera'),
    toggleMic: () => toggleDevice('mic'),
    refreshDevices,
    selectDevice,
    toggleScreen,
    peerEntries: () => network?.entries() ?? [],
  };
}
