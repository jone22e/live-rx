<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import type { RemoteMedia } from '../../services/media-network';

/**
 * Reproduz o áudio de todos os participantes remotos (microfone e áudio da tela), independentemente de o
 * tile estar visível. Os elementos de vídeo dos tiles e da apresentação ficam sempre mudos.
 * Tocar o áudio num elemento também é o que faz a track remota alimentar a detecção de quem fala.
 */
const props = defineProps<{
  remotes: RemoteMedia[];
  /** Vira true depois de um gesto do usuário; destrava o áudio quando o autoplay foi bloqueado. */
  audioUnlocked: boolean;
}>();

const emit = defineEmits<{ 'autoplay-blocked': [] }>();

const players = new Map<string, HTMLAudioElement>();

async function play(key: string, stream: MediaStream): Promise<void> {
  let el = players.get(key);
  if (!el) {
    el = new Audio();
    el.autoplay = true;
    players.set(key, el);
  }
  if (el.srcObject !== stream) el.srcObject = stream;
  el.muted = !props.audioUnlocked;
  try {
    await el.play();
  } catch {
    if (!el.muted) {
      el.muted = true;
      emit('autoplay-blocked');
      await el.play().catch(() => undefined);
    }
  }
}

function sync(): void {
  const wanted = new Set<string>();
  for (const remote of props.remotes) {
    wanted.add(`${remote.peerId}:camera`);
    wanted.add(`${remote.peerId}:screen`);
    void play(`${remote.peerId}:camera`, remote.camera);
    void play(`${remote.peerId}:screen`, remote.screen);
  }
  for (const [key, el] of players) {
    if (wanted.has(key)) continue;
    el.pause();
    el.srcObject = null;
    players.delete(key);
  }
}

watch(() => [props.remotes, props.audioUnlocked], sync, { immediate: true, deep: true });

onBeforeUnmount(() => {
  for (const el of players.values()) {
    el.pause();
    el.srcObject = null;
  }
  players.clear();
});
</script>

<template>
  <span class="remote-audio" aria-hidden="true" />
</template>

<style scoped>
.remote-audio {
  display: none;
}
</style>
