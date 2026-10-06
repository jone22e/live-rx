<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
  /** grid = preenche o palco; column = coluna lateral (linha em telas estreitas). */
  layout: 'grid' | 'column';
}>();

const LOCAL_ID = 'me';
const GAP = 12;
const ASPECT = 16 / 9;
/** Limites como no Meet: a grade mostra até 16 pessoas, o resto vira "+N". */
const MAX_GRID_TILES = 16;
const MIN_GRID_TILE_WIDTH = 150;
const MIN_COLUMN_TILE_HEIGHT = 90;

interface TileModel {
  id: string;
  label: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  presenting: boolean;
  speaking: boolean;
  isLocal: boolean;
}

/** Um tile por participante, na ordem de entrada, com este participante por último. */
const tiles = computed<TileModel[]>(() => {
  const byPeer = new Map(props.remotes.map((r) => [r.peerId, r]));
  const remote = props.participants.map((p) => {
    const media = byPeer.get(p.peerId);
    return {
      id: p.peerId,
      label: p.name,
      stream: media?.camera ?? null,
      hasVideo: media?.hasVideo ?? false,
      hasAudio: media?.hasAudio ?? false,
      presenting: media?.hasScreen ?? false,
      speaking: props.speakingIds.includes(p.peerId),
      isLocal: false,
    };
  });
  const local: TileModel = {
    id: LOCAL_ID,
    label: props.localLabel,
    stream: props.localStream,
    hasVideo: props.localHasVideo,
    hasAudio: props.localHasAudio,
    presenting: props.localPresenting,
    speaking: props.speakingIds.includes(LOCAL_ID),
    isLocal: true,
  };
  return [...remote, local];
});

/* ---------- medida do container (sem rolagem: o que não cabe vira "+N") ---------- */
const container = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!container.value) return;
  const measure = () => {
    if (!container.value) return;
    size.value = { width: container.value.clientWidth, height: container.value.clientHeight };
  };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(container.value);
});

onBeforeUnmount(() => observer?.disconnect());

const narrow = computed(() => size.value.width > 0 && size.value.width > size.value.height * 2.2 && props.layout === 'column');

/** Melhor divisão em linhas/colunas para n tiles 16:9 dentro do container. */
function bestGrid(n: number, width: number, height: number): { tileWidth: number; cols: number } {
  let best = { tileWidth: 0, cols: 1 };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const byWidth = (width - GAP * (cols - 1)) / cols;
    const byHeight = ((height - GAP * (rows - 1)) / rows) * ASPECT;
    const tileWidth = Math.min(byWidth, byHeight);
    if (tileWidth > best.tileWidth) best = { tileWidth, cols };
  }
  return best;
}

/** Quantos tiles cabem sem rolagem no layout atual. */
const capacity = computed(() => {
  const { width, height } = size.value;
  const total = tiles.value.length;
  if (width === 0 || height === 0) return total;
  if (props.layout === 'grid') {
    for (let n = Math.min(total, MAX_GRID_TILES); n > 1; n -= 1) {
      if (bestGrid(n, width, height).tileWidth >= MIN_GRID_TILE_WIDTH) return n;
    }
    return 1;
  }
  if (narrow.value) {
    // Linha horizontal (telas estreitas): tiles de largura fixa.
    return Math.max(1, Math.floor((width + GAP) / (150 + GAP)));
  }
  const tileHeight = Math.max(MIN_COLUMN_TILE_HEIGHT, width / ASPECT);
  return Math.max(1, Math.floor((height + GAP) / (tileHeight + GAP)));
});

const gridTileWidth = computed(() => {
  const shown = Math.min(tiles.value.length, capacity.value);
  const { width, height } = size.value;
  if (props.layout !== 'grid' || width === 0 || height === 0) return 0;
  return Math.min(bestGrid(shown, width, height).tileWidth, 960);
});

/* ---------- seleção estável de quem aparece (quem fala entra no lugar de quem está calado) ---------- */
const lastSpokeAt = new Map<string, number>();
const visibleIds = ref<string[]>([]);

function priorityOf(tile: TileModel): number {
  if (tile.isLocal || tile.presenting) return Number.POSITIVE_INFINITY;
  if (tile.speaking) return Date.now();
  return lastSpokeAt.get(tile.id) ?? 0;
}

function recomputeVisible(): void {
  const now = Date.now();
  for (const id of props.speakingIds) lastSpokeAt.set(id, now);
  const all = tiles.value;
  const ids = new Set(all.map((t) => t.id));
  const slots = all.length > capacity.value ? Math.max(1, capacity.value - 1) : all.length;

  // Mantém quem já estava visível (e ainda existe), na mesma posição; completa com os demais por ordem de entrada.
  let current = visibleIds.value.filter((id) => ids.has(id));
  for (const tile of all) {
    if (current.length >= slots) break;
    if (!current.includes(tile.id)) current.push(tile.id);
  }
  current = current.slice(0, slots);

  // Quem precisa aparecer (local, apresentador, falando) e está oculto troca de lugar com o visível menos prioritário.
  const byId = new Map(all.map((t) => [t.id, t]));
  const mustShow = all.filter((t) => (t.isLocal || t.presenting || t.speaking) && !current.includes(t.id));
  for (const tile of mustShow) {
    let worstIndex = -1;
    let worstPriority = Number.POSITIVE_INFINITY;
    current.forEach((id, index) => {
      const candidate = byId.get(id);
      const priority = candidate ? priorityOf(candidate) : -1;
      if (priority < worstPriority) {
        worstPriority = priority;
        worstIndex = index;
      }
    });
    if (worstIndex >= 0 && worstPriority < priorityOf(tile)) current[worstIndex] = tile.id;
  }
  visibleIds.value = current;
}

watch([tiles, capacity, () => props.speakingIds], recomputeVisible, { immediate: true, deep: true });

const visibleTiles = computed(() => {
  const byId = new Map(tiles.value.map((t) => [t.id, t]));
  return visibleIds.value.map((id) => byId.get(id)).filter((t): t is TileModel => t !== undefined);
});

const hiddenTiles = computed(() => {
  const shown = new Set(visibleIds.value);
  return tiles.value.filter((t) => !shown.has(t.id));
});

function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.charAt(0) ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '')).toUpperCase() || '?';
}
</script>

<template>
  <div
    ref="container"
    class="strip"
    :class="[layout, { narrow }]"
    :style="layout === 'grid' && gridTileWidth > 0 ? { '--tile-w': `${gridTileWidth}px` } : undefined"
    role="list"
  >
    <ParticipantTile
      v-for="tile in visibleTiles"
      :key="tile.id"
      :stream="tile.stream"
      :label="tile.label"
      :has-video="tile.hasVideo"
      :has-audio="tile.hasAudio"
      :is-presenting="tile.presenting"
      :is-local="tile.isLocal"
      :speaking="tile.speaking"
    />
    <div v-if="hiddenTiles.length > 0" class="overflow tile-like" role="listitem" :title="hiddenTiles.map((t) => t.label).join(', ')">
      <div class="avatars">
        <span v-for="tile in hiddenTiles.slice(0, 3)" :key="tile.id" class="avatar">{{ initials(tile.label) }}</span>
      </div>
      <span class="count">+{{ hiddenTiles.length }}</span>
      <span class="hint">{{ hiddenTiles.length === 1 ? 'outra pessoa' : 'outras pessoas' }}</span>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Grade que preenche o palco: largura calculada para caber todo mundo sem rolagem. */
.strip.grid {
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
}

.strip.grid > * {
  flex: 0 0 var(--tile-w, 280px);
  width: var(--tile-w, 280px);
}

.strip.column {
  flex-direction: column;
}

.strip.column > * {
  width: 100%;
  flex: 0 0 auto;
}

/* Coluna que virou linha (telas estreitas) */
.strip.column.narrow {
  flex-direction: row;
}

.strip.column.narrow > * {
  flex: 0 0 150px;
  width: 150px;
}

.overflow {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  background: var(--room-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text);
}

.avatars {
  display: flex;
}

.avatars .avatar {
  width: 34px;
  height: 34px;
  margin-left: -8px;
  border-radius: 50%;
  border: 2px solid var(--room-surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.avatars .avatar:first-child {
  margin-left: 0;
}

.count {
  font-size: 20px;
  font-weight: 700;
}

.hint {
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
