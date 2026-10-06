<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  stream: MediaStream | null;
  label: string;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Tile do próprio usuário: sempre mudo (evita eco) e espelhado. */
  isLocal?: boolean;
  isPresenting?: boolean;
  speaking?: boolean;
  /** Vira true depois de um gesto do usuário; destrava o áudio dos tiles remotos. */
  audioUnlocked: boolean;
}>();

const emit = defineEmits<{ 'autoplay-blocked': [] }>();

const video = ref<HTMLVideoElement | null>(null);

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

async function attach(): Promise<void> {
  const el = video.value;
  if (!el) return;
  if (el.srcObject !== props.stream) el.srcObject = props.stream;
  if (!props.stream) return;
  el.muted = props.isLocal === true || !props.audioUnlocked;
  try {
    await el.play();
  } catch {
    if (el.muted) return;
    el.muted = true;
    emit('autoplay-blocked');
    try {
      await el.play();
    } catch {
      /* sem mídia ainda; tenta de novo na próxima mudança */
    }
  }
}

onMounted(() => void attach());
watch(() => [props.stream, props.audioUnlocked, props.hasVideo, props.hasAudio], () => void attach(), { flush: 'post' });

onBeforeUnmount(() => {
  if (video.value) video.value.srcObject = null;
});
</script>

<template>
  <figure class="tile" :class="{ mirrored: isLocal, speaking }">
    <video ref="video" autoplay playsinline :class="{ hidden: !hasVideo }" />
    <div v-if="!hasVideo" class="placeholder" aria-hidden="true">
      <span class="avatar">{{ initials(label) }}</span>
    </div>
    <span v-if="isPresenting" class="presenting">Apresentando</span>
    <figcaption>{{ label }}</figcaption>
    <span v-if="!hasAudio" class="mic-off" title="Microfone desligado" aria-label="Microfone desligado">
      <AppIcon name="mic-off" :size="14" />
    </span>
  </figure>
</template>

<style scoped>
.tile {
  position: relative;
  margin: 0;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: var(--room-surface);
  box-shadow: 0 0 0 2px transparent;
  transition: box-shadow 0.15s ease;
}

.tile.speaking {
  box-shadow: 0 0 0 2px var(--accent);
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}

video.hidden {
  visibility: hidden;
  position: absolute;
}

.mirrored video {
  transform: scaleX(-1);
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.presenting {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(79, 124, 255, 0.85);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

figcaption {
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

.mic-off {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #ff8a8e;
}

@container (max-width: 220px) {
  .avatar {
    width: 44px;
    height: 44px;
    font-size: 17px;
  }
}
</style>
