<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MAX_DISPLAY_NAME_LENGTH, isRoomCode, normalizeRoomCode } from '../../../shared/protocol';
import DebugPanel from '../components/DebugPanel.vue';
import PreJoinPanel from '../components/room/PreJoinPanel.vue';
import RoomHeader from '../components/room/RoomHeader.vue';
import RoomInfoPanel from '../components/room/RoomInfoPanel.vue';
import RoomStage from '../components/room/RoomStage.vue';
import RoomToolbar from '../components/room/RoomToolbar.vue';
import type { BadgeTone } from '../components/StatusBadge.vue';
import { useDebugMode } from '../composables/useDebugMode';
import { useFullscreen } from '../composables/useFullscreen';
import { useMeeting } from '../composables/useMeeting';
import { useRtcStats } from '../composables/useRtcStats';
import { useRoomSession } from '../composables/useRoomSession';
import { buildShareUrl } from '../services/config';
import { isRecorderAudioBridgeAvailable, RecorderAudioCapture } from '../services/recorder-audio';
import { getStoredName, normalizeDisplayName, storeName } from '../services/profile';

const props = defineProps<{ code: string }>();

const route = useRoute();
const router = useRouter();
const session = useRoomSession();
const meeting = useMeeting();
const debug = useDebugMode();
const stats = useRtcStats(meeting.peerEntries, debug);

const room = ref<HTMLElement | null>(null);
const stage = ref<InstanceType<typeof RoomStage> | null>(null);
const mainVideo = computed(() => stage.value?.videoElement ?? null);
const { isFullscreen, isSupported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen(room, mainVideo);

const audioUnlocked = ref(true);
const infoOpen = ref(false);
const invalidCode = ref(false);
const displayName = ref(getStoredName());
const joinedName = ref('');
/** Token de entrada no link (?t=): o nome vem do servidor e não aparece no link. */
const joinToken = typeof route.query['t'] === 'string' ? route.query['t'] : '';
const tokenName = ref<string | null>(null);
const tokenChecked = ref(joinToken === '');
/** Token de gravador (ex.: ScreenRx): entra direto, sem pré-entrada, câmera ou microfone, e sem barra de controles. */
const recorderMode = ref(false);

/** Vindo da página inicial: entra direto (nome já informado) e, se criou a sala, abre o painel com o código. */
interface EntryState {
  autoJoin?: boolean;
  created?: boolean;
  roomName?: string;
}
const entry: EntryState = typeof history.state === 'object' && history.state !== null ? (history.state as EntryState) : {};

const roomCode = computed(() => normalizeRoomCode(props.code));
const shareUrl = computed(() => buildShareUrl(roomCode.value));
const nameOk = computed(() => normalizeDisplayName(displayName.value).length > 0);
/** Decidido antes da primeira renderização, para a pré-entrada não aparecer (nem ligar mídia) de passagem. */
const autoJoining = entry.autoJoin === true && nameOk.value && isRoomCode(roomCode.value);
/** Pré-entrada (como no Meet): prévia da câmera, dispositivos e nome antes de conectar. */
/** Enquanto o token do link é consultado, nada de pré-entrada: ela ligaria câmera e microfone, que um gravador não deve ter. */
const checkingToken = computed(() => joinToken !== '' && !tokenChecked.value && session.state.status === 'idle' && !invalidCode.value);
const preJoin = computed(() => session.state.status === 'idle' && !invalidCode.value && !autoJoining && !recorderMode.value && !checkingToken.value);

/** Gravadores não são pessoas: ficam fora dos tiles e da contagem, e acendem o aviso "Gravando". */
const people = computed(() => meeting.state.participants.filter((p) => !p.recorder));
const recording = computed(() => recorderMode.value || meeting.state.participants.some((p) => p.recorder === true));

const mediaDisabledReason = computed(() => (meeting.state.active ? null : 'Aguardando conexão com a sala.'));

interface BadgeSpec {
  label: string;
  tone: BadgeTone;
  pulse: boolean;
}

const badge = computed<BadgeSpec>(() => {
  switch (session.state.status) {
    case 'live':
      return { label: 'Ao vivo', tone: 'live', pulse: true };
    case 'connecting':
      return { label: 'Conectando...', tone: 'warn', pulse: true };
    case 'reconnecting':
      return { label: 'Reconectando...', tone: 'warn', pulse: true };
    case 'ended':
      return { label: 'Sala encerrada', tone: 'neutral', pulse: false };
    case 'error':
      return { label: 'Indisponível', tone: 'error', pulse: false };
    case 'idle':
      return { label: 'Pronto para entrar', tone: 'neutral', pulse: false };
  }
});

const overlay = computed(() => {
  if (invalidCode.value) return { title: 'Código inválido', text: 'O código da sala deve ter 6 caracteres.', retry: false, spinner: false };
  switch (session.state.status) {
    case 'connecting':
      return { title: 'Entrando na sala...', text: 'Conectando ao servidor de sinalização.', retry: false, spinner: true };
    case 'reconnecting':
      return { title: 'Reconectando...', text: 'A conexão foi interrompida. Tentando restabelecer.', retry: false, spinner: true };
    case 'ended':
      return { title: 'Sala encerrada', text: session.state.message ?? '', retry: false, spinner: false };
    case 'error':
      return { title: 'Sala indisponível', text: session.state.message ?? '', retry: true, spinner: false };
    case 'live':
    case 'idle':
      return null;
  }
});

function join(): void {
  const roomName = entry.created ? (entry.roomName ?? '') : '';
  if (tokenName.value) {
    joinedName.value = tokenName.value;
    void session.join(roomCode.value, { joinToken }, roomName, tokenName.value);
    return;
  }
  const name = normalizeDisplayName(displayName.value);
  if (!name) return;
  storeName(name);
  joinedName.value = name;
  void session.join(roomCode.value, { displayName: name }, roomName);
}

/** Descobre o nome associado ao token antes de mostrar a pré-entrada. Token inválido cai no fluxo normal. */
async function resolveToken(): Promise<void> {
  if (!joinToken) return;
  try {
    const res = await fetch(`/api/public/rooms/${encodeURIComponent(roomCode.value)}/join-tokens/${encodeURIComponent(joinToken)}`);
    if (res.ok) {
      const data = (await res.json()) as { name: string; recorder?: boolean };
      tokenName.value = data.name;
      recorderMode.value = data.recorder === true;
    }
  } catch {
    /* sem rede ou servidor fora: segue pedindo o nome */
  } finally {
    tokenChecked.value = true;
  }
  if (recorderMode.value) join();
}

/** Token recusado na entrada (venceu entre a consulta e o join): volta a pedir o nome. */
watch(() => session.state.errorCode, (code) => {
  if (code === 'invalid-token') {
    tokenName.value = null;
    recorderMode.value = false;
  }
});

/**
 * Dentro do ScreenRx (modo gravador): o áudio de todos os participantes é mixado e entregue ao app pela
 * ponte `screenrxMeetAudio`, que o grava junto com a tela. Fora dele (ou sem a ponte) nada acontece.
 */
let audioCapture: RecorderAudioCapture | null = null;
watch(
  () => [recorderMode.value, session.state.status, meeting.state.remotes] as const,
  ([isRecorder, status, remotes]) => {
    const bridge = window.screenrxMeetAudio;
    if (!isRecorder || !bridge || !isRecorderAudioBridgeAvailable()) return;
    if (status !== 'live') return;
    audioCapture ??= new RecorderAudioCapture(bridge);
    if (!audioCapture.running) audioCapture.start();
    audioCapture.setTracks(remotes.flatMap((r) => [...r.camera.getAudioTracks(), ...r.screen.getAudioTracks()]));
  },
  { immediate: true },
);

function onPageHide(): void {
  session.notifyLeave();
}

function leave(): void {
  void router.push({ name: 'home', query: route.query });
}

onMounted(() => {
  if (!isRoomCode(roomCode.value)) {
    invalidCode.value = true;
    return;
  }
  window.addEventListener('pagehide', onPageHide);
  void resolveToken();
  if (autoJoining) {
    infoOpen.value = entry.created === true;
    join();
  }
});

onBeforeUnmount(() => {
  void audioCapture?.stop();
  window.removeEventListener('pagehide', onPageHide);
  session.leave();
  meeting.stopLocalMedia();
});

const debugInfo = computed(() => [
  { key: 'status', value: session.state.status },
  { key: 'peerId', value: session.state.peerId },
  { key: 'roomId', value: session.state.roomId },
  { key: 'signaling', value: session.state.signaling },
  { key: 'participants', value: meeting.state.participants.map((p) => `${p.name}:${p.peerId.slice(0, 8)}`).join(', ') },
  { key: 'remotes', value: meeting.state.remotes.map((r) => `${r.peerId.slice(0, 8)}:${r.hasVideo ? 'v' : '-'}${r.hasAudio ? 'a' : '-'}${r.hasScreen ? 's' : '-'}`).join(', ') },
  { key: 'mediaServer', value: meeting.state.mediaServer },
  { key: 'presenters', value: meeting.state.presenters.join(', ') },
  { key: 'speaking', value: meeting.state.speaking.join(', ') },
]);
</script>

<template>
  <div ref="room" class="room">
    <section v-if="checkingToken" class="prejoin checking">
      <span class="spinner" />
      <p class="muted">Verificando o link...</p>
    </section>

    <section v-else-if="preJoin" class="prejoin">
      <header class="topbar">
        <span class="brand">
          <span class="brand-dot" />
          Screen Live
        </span>
      </header>
      <div class="prejoin-content">
        <section class="left">
          <PreJoinPanel :auto-start="true" />
        </section>
        <form class="prejoin-card" @submit.prevent="join">
          <h1>Pronto para participar?</h1>
          <p class="muted">Sala <span class="mono code">{{ roomCode }}</span></p>
          <p v-if="tokenName" class="identity">Você vai entrar como <strong>{{ tokenName }}</strong></p>
          <label v-else class="field">
            <span>Seu nome</span>
            <input v-model="displayName" class="input" type="text" autocomplete="name" :maxlength="MAX_DISPLAY_NAME_LENGTH" placeholder="Como os outros vão te ver" />
          </label>
          <p v-if="session.state.errorCode === 'invalid-token'" class="hint error">{{ session.state.message }}</p>
          <button type="submit" class="btn btn-primary big-btn" :disabled="!tokenChecked || (!tokenName && !nameOk)">Participar</button>
          <button type="button" class="btn btn-ghost" @click="leave">Voltar ao início</button>
        </form>
      </div>
    </section>

    <template v-else>
      <RoomHeader
        :room-name="session.state.roomName || 'Sala'"
        :started-at="meeting.state.joinedAt"
        :badge-label="badge.label"
        :badge-tone="badge.tone"
        :badge-pulse="badge.pulse"
        :recording="recording"
      />

      <RoomStage
        ref="stage"
        :presentation="meeting.presentation.value"
        :local-stream="meeting.state.localStream"
        :local-has-video="meeting.state.cameraOn"
        :local-has-audio="meeting.state.micOn"
        :local-label="`${joinedName} (você)`"
        :local-presenting="meeting.state.screenOn"
        :local-hidden="recorderMode"
        :participants="people"
        :remotes="meeting.state.remotes"
        :speaking-ids="meeting.state.speaking"
        :active-speaker="meeting.activeSpeaker.value"
        :audio-unlocked="audioUnlocked"
        @autoplay-blocked="audioUnlocked = false"
      >
        <template #overlay>
          <div v-if="overlay" class="overlay" :class="{ translucent: session.state.status === 'reconnecting' }">
            <div class="overlay-card">
              <span v-if="overlay.spinner" class="spinner" />
              <h1>{{ overlay.title }}</h1>
              <p v-if="overlay.text" class="muted">{{ overlay.text }}</p>
              <div class="overlay-actions">
                <button v-if="overlay.retry && !invalidCode" type="button" class="btn btn-primary" @click="session.retry()">Tentar novamente</button>
                <button type="button" class="btn btn-ghost" @click="leave">Voltar ao início</button>
              </div>
            </div>
          </div>
        </template>
      </RoomStage>

      <RoomInfoPanel v-if="infoOpen" :room-name="session.state.roomName || 'Sala'" :code="roomCode" :share-url="shareUrl" @close="infoOpen = false" />

      <p v-if="meeting.state.notice" class="toast">{{ meeting.state.notice }}</p>

      <RoomToolbar
        v-if="!recorderMode"
        :code="roomCode"
        :mic-on="meeting.state.micOn"
        :camera-on="meeting.state.cameraOn"
        :screen-on="meeting.state.screenOn"
        :screen-supported="meeting.screenSupported"
        :media-busy="meeting.state.busy"
        :media-disabled-reason="mediaDisabledReason"
        :people-count="people.length + 1"
        :info-open="infoOpen"
        :needs-unmute="!audioUnlocked"
        :fullscreen-supported="fullscreenSupported"
        :is-fullscreen="isFullscreen"
        @toggle-mic="meeting.toggleMic()"
        @toggle-camera="meeting.toggleCamera()"
        @toggle-screen="meeting.toggleScreen()"
        @leave="leave"
        @toggle-info="infoOpen = !infoOpen"
        @toggle-fullscreen="toggleFullscreen"
        @unmute="audioUnlocked = true"
      />
    </template>

    <DebugPanel v-if="debug" :info="debugInfo" :peers="stats" />
  </div>
</template>

<style scoped>
.room {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--room-bg);
}

.prejoin {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.prejoin .topbar {
  border-bottom: none;
  background: transparent;
}

.prejoin.checking {
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.prejoin-content {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: center;
  gap: 56px;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 12px 40px 40px;
}

.prejoin-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 480px;
}

.prejoin-card h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.prejoin-card p {
  margin: -6px 0 0;
}

.big-btn {
  min-height: 48px;
  font-size: 15px;
}

@media (max-width: 900px) {
  .prejoin-content {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 8px 20px 24px;
  }
}

.prejoin-card .code {
  letter-spacing: 0.12em;
  color: var(--text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.identity {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.identity strong {
  color: var(--text);
}

.hint {
  margin: 0;
  font-size: 13px;
}

.hint.error {
  color: #ff8a8e;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  z-index: 6;
  margin: 0;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: #ff8a8e;
  font-size: 13.5px;
}

.overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--room-bg);
}

.overlay.translucent {
  background: rgba(32, 33, 36, 0.8);
}

.overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  text-align: center;
}

.overlay-card h1 {
  margin: 0;
  font-size: 20px;
}

.overlay-card p {
  margin: 0;
}

.overlay-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
