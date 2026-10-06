<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { Participant } from '../../../../shared/protocol';
import type { ActiveSpeaker, Presentation } from '../../composables/useMeeting';
import type { RemoteMedia } from '../../services/media-network';
import ParticipantsStrip from '../ParticipantsStrip.vue';
import SpeakingIndicator from './SpeakingIndicator.vue';

const props = defineProps<{
  presentation: Presentation | null;
  localStream: MediaStream;
  localHasVideo: boolean;
  localHasAudio: boolean;
  localLabel: string;
  localPresenting: boolean;
  participants: Participant[];
  remotes: RemoteMedia[];
  speakingIds: string[];
  activeSpeaker: ActiveSpeaker | null;
  audioUnlocked: boolean;
}>();

const emit = defineEmits<{ 'autoplay-blocked': [] }>();

const video = ref<HTMLVideoElement | null>(null);

async function attach(): Promise<void> {
  const el = video.value;
  const stream = props.presentation?.stream ?? null;
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (!stream) return;
  el.muted = props.presentation?.isLocal === true || !props.audioUnlocked;
  try {
    await el.play();
  } catch {
    if (el.muted) return;
    // Autoplay com áudio bloqueado (sem gesto do usuário): toca mudo e avisa para oferecer "Ativar som".
    el.muted = true;
    emit('autoplay-blocked');
    try {
      await el.play();
    } catch (error) {
      console.warn('[stage] play() falhou', error);
    }
  }
}

onMounted(() => void attach());
watch(() => [props.presentation?.stream, props.presentation?.isLocal, props.audioUnlocked], () => void attach(), { flush: 'post' });

defineExpose({ videoElement: video });
</script>

<template>
  <div class="stage" :class="{ presenting: presentation !== null }">
    <div class="main">
      <template v-if="presentation">
        <video ref="video" class="main-video" autoplay playsinline />
        <span class="presentation-label">{{ presentation.label }}</span>
      </template>
      <ParticipantsStrip
        v-else
        layout="grid"
        :local-stream="localStream"
        :local-has-video="localHasVideo"
        :local-has-audio="localHasAudio"
        :local-label="localLabel"
        :local-presenting="localPresenting"
        :participants="participants"
        :remotes="remotes"
        :speaking-ids="speakingIds"
        :audio-unlocked="audioUnlocked"
        @autoplay-blocked="emit('autoplay-blocked')"
      />
      <Transition name="fade">
        <div v-if="activeSpeaker" class="speaker-slot">
          <SpeakingIndicator :speaker="activeSpeaker" />
        </div>
      </Transition>
      <slot name="overlay" />
    </div>
    <div v-if="presentation" class="side">
      <ParticipantsStrip
        layout="column"
        :local-stream="localStream"
        :local-has-video="localHasVideo"
        :local-has-audio="localHasAudio"
        :local-label="localLabel"
        :local-presenting="localPresenting"
        :participants="participants"
        :remotes="remotes"
        :speaking-ids="speakingIds"
        :audio-unlocked="audioUnlocked"
        @autoplay-blocked="emit('autoplay-blocked')"
      />
    </div>
  </div>
</template>

<style scoped>
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 4px 20px 0;
}

.main {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  overflow: hidden;
}

.presenting .main {
  background: #000;
}

.main-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
}

.presentation-label {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
}

.speaker-slot {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 4;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.side {
  flex: 0 0 236px;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 860px) {
  .stage {
    flex-direction: column;
    padding: 4px 8px 0;
  }

  .side {
    flex: 0 0 auto;
    overflow-x: auto;
  }
}
</style>
