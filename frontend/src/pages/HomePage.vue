<script setup lang="ts">
import { computed, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { MAX_DISPLAY_NAME_LENGTH, MAX_ROOM_NAME_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_MAX_LENGTH, isRoomCode, normalizeRoomCode } from '../../../shared/protocol';
import PreJoinPanel from '../components/room/PreJoinPanel.vue';
import { useMeeting } from '../composables/useMeeting';
import { getStoredName, normalizeDisplayName, storeName } from '../services/profile';

const router = useRouter();
const route = useRoute();
const meeting = useMeeting();

const webrtcSupported = typeof RTCPeerConnection !== 'undefined';
const displayName = ref(getStoredName());
const roomName = ref('');
const code = ref('');
const error = ref<string | null>(null);

const nameOk = computed(() => normalizeDisplayName(displayName.value).length > 0);
const canWatch = computed(() => nameOk.value && isRoomCode(code.value));

/** Código aleatório para uma sala nova (salas são abertas: o código vira sala no primeiro acesso). */
function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ROOM_CODE_ALPHABET.charAt(b % ROOM_CODE_ALPHABET.length)).join('');
}

function onCodeInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  code.value = normalizeRoomCode(input.value).slice(0, ROOM_CODE_MAX_LENGTH);
  input.value = code.value;
  error.value = null;
}

function requireName(): string | null {
  const name = normalizeDisplayName(displayName.value);
  if (!name) {
    error.value = 'Informe seu nome para continuar.';
    return null;
  }
  storeName(name);
  return name;
}

async function createRoom(): Promise<void> {
  const name = requireName();
  if (!name) return;
  error.value = null;
  await router.push({
    name: 'live',
    params: { code: generateRoomCode() },
    query: route.query,
    state: { autoJoin: true, created: true, roomName: roomName.value.trim().slice(0, MAX_ROOM_NAME_LENGTH) },
  });
}

async function joinRoom(): Promise<void> {
  const name = requireName();
  if (!name) return;
  if (!isRoomCode(code.value)) {
    error.value = `Informe o código da sala (${ROOM_CODE_LENGTH} a ${ROOM_CODE_MAX_LENGTH} caracteres).`;
    return;
  }
  await router.push({ name: 'live', params: { code: code.value }, query: route.query, state: { autoJoin: true } });
}

// Câmera/microfone escolhidos aqui seguem para a sala; em qualquer outra saída são desligados.
onBeforeRouteLeave((to) => {
  if (to.name !== 'live') meeting.stopLocalMedia();
});
</script>

<template>
  <div class="page home">
    <header class="topbar">
      <span class="brand">
        <span class="brand-dot" />
        Screen Live
      </span>
    </header>

    <main class="content">
      <section class="left">
        <PreJoinPanel :auto-start="webrtcSupported" />
      </section>

      <section class="right">
        <h1>Pronto para entrar?</h1>

        <label class="field">
          <span>Seu nome</span>
          <input v-model="displayName" class="input" type="text" autocomplete="name" :maxlength="MAX_DISPLAY_NAME_LENGTH" placeholder="Como os outros vão te ver" />
        </label>

        <form class="stack" @submit.prevent="createRoom">
          <input v-model="roomName" class="input" type="text" :maxlength="MAX_ROOM_NAME_LENGTH" placeholder="Nome da reunião (opcional)" aria-label="Nome da reunião" />
          <button type="submit" class="btn btn-primary big-btn" :disabled="!webrtcSupported || !nameOk">Criar sala</button>
        </form>

        <div class="divider"><span>ou</span></div>

        <form class="row" @submit.prevent="joinRoom">
          <input
            id="code"
            class="input mono code-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="Código da sala"
            aria-label="Código da sala"
            :maxlength="ROOM_CODE_MAX_LENGTH"
            :value="code"
            @input="onCodeInput"
          />
          <button type="submit" class="btn btn-outline big-btn" :disabled="!canWatch">Entrar</button>
        </form>

        <p v-if="!webrtcSupported" class="hint error">Seu navegador não suporta WebRTC.</p>
        <p v-else-if="error" class="hint error">{{ error }}</p>
      </section>
    </main>

    <p class="foot">Vídeo e áudio passam cifrados pelo servidor de mídia, que só os encaminha sem gravar nada.</p>
  </div>
</template>

<style scoped>
.home {
  background: var(--room-bg);
}

.home .topbar {
  border-bottom: none;
  background: transparent;
}

.content {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: center;
  gap: 56px;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: 12px 40px 24px;
}

.right {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 480px;
}

h1 {
  margin: 0 0 6px;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  display: flex;
  gap: 10px;
}

.big-btn {
  min-height: 48px;
  font-size: 15px;
  text-decoration: none;
}

.code-input {
  flex: 1;
  min-width: 0;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 17px;
  font-weight: 600;
}

.code-input::placeholder {
  letter-spacing: normal;
  text-transform: none;
  font-family: var(--font);
  font-weight: 400;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-faint);
  font-size: 12px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.hint {
  margin: 0;
  font-size: 13px;
  color: #ff8a8e;
}

.foot {
  margin: 0;
  padding: 16px;
  font-size: 12.5px;
  color: var(--text-faint);
  text-align: center;
}

@media (max-width: 900px) {
  .content {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 8px 20px 16px;
  }

  .right {
    max-width: none;
  }
}
</style>
