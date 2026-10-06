<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMeeting } from '../../composables/useMeeting';
import AppIcon from '../AppIcon.vue';
import DeviceMenu from './DeviceMenu.vue';

/**
 * Prévia da própria câmera com botões divididos de microfone/câmera: a parte principal liga/desliga,
 * a seta abre o menu de dispositivos. O estado escolhido aqui entra junto na sala (a mídia local vive no useMeeting).
 */
const props = defineProps<{
  /** Tenta ligar câmera e microfone ao montar (como no Meet). */
  autoStart?: boolean;
}>();

type Kind = 'camera' | 'mic';

const meeting = useMeeting();
const video = ref<HTMLVideoElement | null>(null);
const root = ref<HTMLElement | null>(null);
const openMenu = ref<Kind | null>(null);
const triedAutoStart = ref(false);

function attach(): void {
  const el = video.value;
  if (!el) return;
  if (el.srcObject !== meeting.state.localStream) el.srcObject = meeting.state.localStream;
  el.muted = true;
  void el.play().catch(() => undefined);
}

function onDocumentClick(event: MouseEvent): void {
  if (openMenu.value && root.value && !root.value.contains(event.target as Node)) openMenu.value = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') openMenu.value = null;
}

onMounted(async () => {
  attach();
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
  await meeting.refreshDevices();
  if (props.autoStart && !triedAutoStart.value && !meeting.state.cameraOn && !meeting.state.micOn) {
    triedAutoStart.value = true;
    await meeting.toggleMic();
    await meeting.toggleCamera();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});

watch(() => [meeting.state.cameraOn, meeting.state.micOn], attach, { flush: 'post' });

async function toggleMenu(kind: Kind): Promise<void> {
  openMenu.value = openMenu.value === kind ? null : kind;
  if (openMenu.value) await meeting.refreshDevices();
}
</script>

<template>
  <div ref="root" class="prejoin-panel">
    <div class="preview" :class="{ off: !meeting.state.cameraOn }">
      <video ref="video" autoplay playsinline muted />
      <span v-if="!meeting.state.cameraOn" class="placeholder mono">{{ meeting.state.busy ? 'ligando a câmera...' : 'câmera desligada' }}</span>

      <div class="controls">
        <div class="split" :class="{ off: !meeting.state.micOn }">
          <button
            type="button"
            class="main"
            :disabled="meeting.state.busy"
            :aria-label="meeting.state.micOn ? 'Desligar microfone' : 'Ligar microfone'"
            @click="meeting.toggleMic()"
          >
            <AppIcon :name="meeting.state.micOn ? 'mic' : 'mic-off'" :size="16" />
            {{ meeting.state.micOn ? 'Microfone ligado' : 'Microfone desligado' }}
          </button>
          <button type="button" class="arrow" aria-label="Escolher microfone" :aria-expanded="openMenu === 'mic'" @click="toggleMenu('mic')">
            <span class="chevron" />
          </button>
          <DeviceMenu v-if="openMenu === 'mic'" kind="mic" @close="openMenu = null" />
        </div>

        <div class="split" :class="{ off: !meeting.state.cameraOn }">
          <button
            type="button"
            class="main"
            :disabled="meeting.state.busy"
            :aria-label="meeting.state.cameraOn ? 'Desligar câmera' : 'Ligar câmera'"
            @click="meeting.toggleCamera()"
          >
            <AppIcon :name="meeting.state.cameraOn ? 'cam' : 'cam-off'" :size="16" />
            {{ meeting.state.cameraOn ? 'Câmera ligada' : 'Câmera desligada' }}
          </button>
          <button type="button" class="arrow" aria-label="Escolher câmera" :aria-expanded="openMenu === 'camera'" @click="toggleMenu('camera')">
            <span class="chevron" />
          </button>
          <DeviceMenu v-if="openMenu === 'camera'" kind="camera" @close="openMenu = null" />
        </div>
      </div>
    </div>

    <p v-if="meeting.state.notice" class="notice">{{ meeting.state.notice }}</p>
  </div>
</template>

<style scoped>
.prejoin-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.preview {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 14px;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.025) 0 10px, transparent 10px 20px),
    var(--room-surface);
}

.preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 14px;
  transform: scaleX(-1);
  background: #000;
}

.preview.off video {
  visibility: hidden;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
}

.controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14px;
  display: flex;
  justify-content: center;
  gap: 10px;
}

.split {
  position: relative;
  display: inline-flex;
  height: 40px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  overflow: visible;
}

.split.off {
  background: var(--live);
}

.split button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.split .main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 16px;
  border-radius: 20px 0 0 20px;
  font-weight: 600;
  font-size: 13.5px;
  white-space: nowrap;
}

.split .main:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.split .main:disabled {
  opacity: 0.6;
  cursor: wait;
}

.split .arrow {
  width: 34px;
  border-radius: 0 20px 20px 0;
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.split .arrow:hover {
  background: rgba(255, 255, 255, 0.08);
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

.notice {
  margin: 0;
  font-size: 13px;
  color: #ff8a8e;
}

@media (max-width: 520px) {
  .split .main {
    font-size: 12.5px;
    padding: 0 10px 0 12px;
  }
}
</style>
