<script setup lang="ts">
import { computed } from 'vue';
import type { Participant } from '../../../shared/protocol';
import type { RemoteMedia } from '../services/media-network';
import ParticipantTile from './ParticipantTile.vue';

const props = defineProps<{
  localStream: MediaStream;
  localHasVideo: boolean;
  localHasAudio: boolean;
  localLabel: string;
  localPresenting: boolean;
  participants: Participant[];
  remotes: RemoteMedia[];
  /** Ids falando agora ('me' = este participante). */
  speakingIds: string[];
  audioUnlocked: boolean;
  /** grid = preenche o palco; column = coluna lateral (linha em telas estreitas). */
  layout: 'grid' | 'column';
}>();

const emit = defineEmits<{ 'autoplay-blocked': [] }>();

interface TileModel {
  peerId: string;
  label: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  presenting: boolean;
  speaking: boolean;
}

/** Um tile por participante da sala, na ordem de entrada, com a mídia remota quando existir. */
const tiles = computed<TileModel[]>(() => {
  const byPeer = new Map(props.remotes.map((r) => [r.peerId, r]));
  return props.participants.map((p) => {
    const media = byPeer.get(p.peerId);
    return {
      peerId: p.peerId,
      label: p.name,
      stream: media?.camera ?? null,
      hasVideo: media?.hasVideo ?? false,
      hasAudio: media?.hasAudio ?? false,
      presenting: media?.hasScreen ?? false,
      speaking: props.speakingIds.includes(p.peerId),
    };
  });
});

const count = computed(() => tiles.value.length + 1);
</script>

<template>
  <div class="strip" :class="layout" :data-count="Math.min(count, 9)" role="list">
    <ParticipantTile
      v-for="tile in tiles"
      :key="tile.peerId"
      :stream="tile.stream"
      :label="tile.label"
      :has-video="tile.hasVideo"
      :has-audio="tile.hasAudio"
      :is-presenting="tile.presenting"
      :speaking="tile.speaking"
      :audio-unlocked="audioUnlocked"
      @autoplay-blocked="emit('autoplay-blocked')"
    />
    <ParticipantTile
      :stream="localStream"
      :label="localLabel"
      :has-video="localHasVideo"
      :has-audio="localHasAudio"
      :is-presenting="localPresenting"
      :is-local="true"
      :speaking="speakingIds.includes('me')"
      :audio-unlocked="audioUnlocked"
    />
  </div>
</template>

<style scoped>
.strip {
  gap: 12px;
  scrollbar-width: thin;
}

.strip > * {
  container-type: inline-size;
}

/* Grade que preenche o palco, com colunas conforme a quantidade de pessoas. */
.strip.grid {
  display: grid;
  width: 100%;
  height: 100%;
  overflow: auto;
  align-content: center;
  justify-content: center;
  grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
}

.strip.grid[data-count='1'] {
  --cols: 1;
  max-width: 900px;
  margin: 0 auto;
}

.strip.grid[data-count='2'] {
  --cols: 2;
}

.strip.grid[data-count='3'],
.strip.grid[data-count='4'] {
  --cols: 2;
}

.strip.grid[data-count='5'],
.strip.grid[data-count='6'] {
  --cols: 3;
}

.strip.grid[data-count='7'],
.strip.grid[data-count='8'],
.strip.grid[data-count='9'] {
  --cols: 3;
}

.strip.column {
  display: flex;
  flex-direction: column;
}

.strip.column > * {
  width: 100%;
  flex: 0 0 auto;
}

@media (max-width: 860px) {
  .strip.grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    align-content: start;
  }

  .strip.grid[data-count='1'],
  .strip.grid[data-count='2'] {
    grid-template-columns: 1fr;
  }

  .strip.column {
    flex-direction: row;
    overflow-x: auto;
    padding: 4px 0;
  }

  .strip.column > * {
    flex: 0 0 150px;
    width: auto;
  }
}
</style>
