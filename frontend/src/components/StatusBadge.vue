<script setup lang="ts">
export type BadgeTone = 'live' | 'ok' | 'warn' | 'neutral' | 'error';

defineProps<{
  label: string;
  tone: BadgeTone;
  pulse?: boolean;
}>();
</script>

<template>
  <span class="badge" :class="[`tone-${tone}`, { pulse }]">
    <span class="dot" />
    {{ label }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.pulse .dot {
  animation: pulse 1.4s ease-in-out infinite;
}

.tone-live {
  color: var(--live);
  border-color: rgba(229, 72, 77, 0.35);
}

.tone-ok {
  color: var(--ok);
}

.tone-warn {
  color: var(--warn);
}

.tone-neutral {
  color: var(--text-muted);
}

.tone-error {
  color: #ff8a8e;
}
</style>
