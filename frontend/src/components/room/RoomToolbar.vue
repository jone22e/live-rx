<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useMeeting } from '../../composables/useMeeting';
import AppIcon from '../AppIcon.vue';
import DeviceMenu from './DeviceMenu.vue';

const props = defineProps<{
  code: string | null;
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  screenSupported: boolean;
  mediaBusy: boolean;
  /** Motivo para desabilitar câmera/microfone (null = habilitados). */
  mediaDisabledReason: string | null;
  peopleCount: number;
  infoOpen: boolean;
  needsUnmute: boolean;
  fullscreenSupported: boolean;
  isFullscreen: boolean;
}>();

const emit = defineEmits<{
  'toggle-mic': [];
  'toggle-camera': [];
  'toggle-screen': [];
  leave: [];
  'toggle-info': [];
  'toggle-fullscreen': [];
  unmute: [];
}>();

const meeting = useMeeting();
const clock = ref(formatClock());
const center = ref<HTMLElement | null>(null);
const openMenu = ref<'camera' | 'mic' | null>(null);
let timer: number | null = null;

async function toggleMenu(kind: 'camera' | 'mic'): Promise<void> {
  openMenu.value = openMenu.value === kind ? null : kind;
  if (openMenu.value) await meeting.refreshDevices();
}

function onDocumentClick(event: MouseEvent): void {
  if (openMenu.value && center.value && !center.value.contains(event.target as Node)) openMenu.value = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') openMenu.value = null;
}

function formatClock(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
  timer = window.setInterval(() => {
    clock.value = formatClock();
  }, 15_000);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});

function deviceDisabled(on: boolean): boolean {
  return props.mediaBusy || (!on && props.mediaDisabledReason !== null);
}
</script>

<template>
  <footer class="toolbar">
    <div class="left">
      <span class="clock mono">{{ clock }}</span>
      <span v-if="code" class="sep">·</span>
      <span v-if="code" class="code mono">{{ code }}</span>
    </div>

    <div ref="center" class="center">
      <div class="split" :class="{ off: !micOn }">
        <button
          type="button"
          class="pill main"
          :disabled="deviceDisabled(micOn)"
          :aria-label="micOn ? 'Desligar microfone' : 'Ligar microfone'"
          :title="micOn ? 'Desligar microfone' : (mediaDisabledReason ?? 'Ligar microfone')"
          @click="emit('toggle-mic')"
        >
          <AppIcon :name="micOn ? 'mic' : 'mic-off'" :size="18" />
          <span>Microfone</span>
        </button>
        <button type="button" class="pill arrow" aria-label="Escolher microfone" title="Escolher microfone" :aria-expanded="openMenu === 'mic'" @click="toggleMenu('mic')">
          <span class="chevron" />
        </button>
        <DeviceMenu v-if="openMenu === 'mic'" kind="mic" @close="openMenu = null" />
      </div>
      <div class="split" :class="{ off: !cameraOn }">
        <button
          type="button"
          class="pill main"
          :disabled="deviceDisabled(cameraOn)"
          :aria-label="cameraOn ? 'Desligar câmera' : 'Ligar câmera'"
          :title="cameraOn ? 'Desligar câmera' : (mediaDisabledReason ?? 'Ligar câmera')"
          @click="emit('toggle-camera')"
        >
          <AppIcon :name="cameraOn ? 'cam' : 'cam-off'" :size="18" />
          <span>Câmera</span>
        </button>
        <button type="button" class="pill arrow" aria-label="Escolher câmera" title="Escolher câmera" :aria-expanded="openMenu === 'camera'" @click="toggleMenu('camera')">
          <span class="chevron" />
        </button>
        <DeviceMenu v-if="openMenu === 'camera'" kind="camera" @close="openMenu = null" />
      </div>
      <button
        type="button"
        class="pill"
        :class="{ active: screenOn }"
        :disabled="mediaBusy || !screenSupported"
        :aria-label="screenOn ? 'Parar de compartilhar' : 'Compartilhar tela'"
        :title="screenSupported ? (screenOn ? 'Parar de compartilhar' : 'Compartilhar tela') : 'Seu navegador/dispositivo não suporta compartilhamento de tela.'"
        @click="emit('toggle-screen')"
      >
        <AppIcon name="screen" :size="18" />
        <span>{{ screenOn ? 'Parar' : 'Compartilhar' }}</span>
      </button>
      <button type="button" class="pill leave" aria-label="Sair da sala" title="Sair da sala" @click="emit('leave')">
        <AppIcon name="call-end" :size="18" />
        <span>Sair</span>
      </button>
    </div>

    <div class="right">
      <button v-if="needsUnmute" type="button" class="pill accent" aria-label="Ativar som" @click="emit('unmute')">
        <AppIcon name="volume" :size="18" />
        <span>Ativar som</span>
      </button>
      <button
        type="button"
        class="pill ghost"
        :class="{ active: infoOpen }"
        aria-label="Informações da sala"
        title="Informações da sala"
        @click="emit('toggle-info')"
      >
        <AppIcon name="info" :size="18" />
        <span class="hide-sm">Informações</span>
      </button>
      <span class="people" title="Pessoas na sala" aria-label="Pessoas na sala">
        <AppIcon name="people" :size="18" />
        <span>Pessoas</span>
        <span class="count">{{ peopleCount }}</span>
      </span>
      <button
        v-if="fullscreenSupported"
        type="button"
        class="icon-btn"
        :aria-label="isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'"
        :title="isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'"
        @click="emit('toggle-fullscreen')"
      >
        <AppIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" :size="20" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.toolbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  height: 76px;
  padding: 0 20px;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.right {
  justify-content: flex-end;
}

.center {
  display: flex;
  align-items: center;
  gap: 10px;
}

.clock,
.code {
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.sep {
  color: var(--text-faint);
}

.code {
  letter-spacing: 0.1em;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 18px;
  border-radius: 23px;
  border: none;
  background: #3c4043;
  color: #fff;
  font-weight: 600;
  font-size: 14.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, transform 0.08s ease;
}

.pill:hover:not(:disabled) {
  background: #4a4e52;
}

.pill:active:not(:disabled) {
  transform: scale(0.97);
}

.pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pill.off {
  background: var(--live);
}

.pill.off:hover:not(:disabled) {
  background: #f0555a;
}

/* Botão dividido: a parte principal liga/desliga, a seta abre o menu de dispositivos. */
.split {
  position: relative;
  display: inline-flex;
  border-radius: 23px;
  background: #3c4043;
}

.split.off {
  background: var(--live);
}

.split .pill {
  background: transparent;
}

.split .pill:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.split .main {
  border-radius: 23px 0 0 23px;
  padding-right: 14px;
}

.split .arrow {
  width: 36px;
  padding: 0;
  border-radius: 0 23px 23px 0;
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  justify-content: center;
}

.chevron {
  width: 7px;
  height: 7px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
}

.arrow[aria-expanded='true'] .chevron {
  transform: translateY(2px) rotate(225deg);
}

.pill.active {
  background: var(--accent);
}

.pill.active:hover:not(:disabled) {
  background: var(--accent-hover);
}

.pill.leave {
  background: var(--live);
  padding: 0 22px;
}

.pill.leave:hover {
  background: #f0555a;
}

.pill.accent {
  background: var(--accent);
}

.pill.ghost {
  background: transparent;
  color: var(--text-muted);
  height: 40px;
  padding: 0 12px;
}

.pill.ghost:hover:not(:disabled),
.pill.ghost.active {
  background: #3c4043;
  color: #fff;
}

.people {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  color: var(--text);
  font-weight: 600;
  font-size: 14px;
}

.count {
  color: var(--text-muted);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: #3c4043;
  color: #fff;
}

@media (max-width: 900px) {
  .pill span {
    display: none;
  }

  .pill {
    width: 46px;
    padding: 0;
    justify-content: center;
  }

  .split .main {
    width: 46px;
    padding: 0;
  }

  .split .arrow {
    width: 30px;
  }

  .pill.leave {
    width: 60px;
    border-radius: 23px;
  }

  .people span:not(.count) {
    display: none;
  }
}

@media (max-width: 720px) {
  .toolbar {
    grid-template-columns: auto 1fr auto;
    height: 68px;
    padding: 0 10px;
  }

  .clock,
  .sep {
    display: none;
  }

  .center {
    justify-content: center;
    gap: 8px;
  }

  .hide-sm {
    display: none;
  }
}
</style>
