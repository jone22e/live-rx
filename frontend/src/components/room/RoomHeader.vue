<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import StatusBadge, { type BadgeTone } from '../StatusBadge.vue';

const props = defineProps<{
  roomName: string;
  startedAt: number | null;
  badgeLabel: string;
  badgeTone: BadgeTone;
  badgePulse: boolean;
}>();

const elapsed = ref('');
let timer: number | null = null;

function tick(): void {
  if (props.startedAt === null) {
    elapsed.value = '';
    return;
  }
  const total = Math.max(0, Math.floor((Date.now() - props.startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  elapsed.value = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

onMounted(() => {
  tick();
  timer = window.setInterval(tick, 1000);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
});
</script>

<template>
  <header class="header">
    <div class="title">
      <h1>{{ roomName }}</h1>
      <span v-if="elapsed" class="elapsed mono">{{ elapsed }}</span>
    </div>
    <StatusBadge :label="badgeLabel" :tone="badgeTone" :pulse="badgePulse" />
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  padding: 0 20px;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.elapsed {
  font-size: 12.5px;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .header {
    padding: 0 12px;
  }
}
</style>
