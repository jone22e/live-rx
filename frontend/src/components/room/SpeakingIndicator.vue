<script setup lang="ts">
import type { ActiveSpeaker } from '../../composables/useMeeting';

defineProps<{ speaker: ActiveSpeaker }>();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
</script>

<template>
  <div class="speaking-indicator" role="status" aria-live="polite">
    <span class="avatar">{{ initials(speaker.name) }}</span>
    <span class="text">
      <span class="name">{{ speaker.isLocal ? 'Você' : speaker.name }}</span>
      <span class="sub">Falando</span>
    </span>
    <span class="bars" aria-hidden="true">
      <i /><i /><i /><i /><i />
    </span>
  </div>
</template>

<style scoped>
.speaking-indicator {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  background: rgba(20, 22, 27, 0.92);
  border: 1px solid var(--border-strong);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: #fff;
  backdrop-filter: blur(8px);
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

.text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.name {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}

.sub {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.bars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  margin-left: 4px;
}

.bars i {
  display: block;
  width: 3px;
  height: 6px;
  border-radius: 2px;
  background: var(--accent-hover);
  animation: wave 0.9s ease-in-out infinite;
}

.bars i:nth-child(2) { animation-delay: 0.15s; }
.bars i:nth-child(3) { animation-delay: 0.3s; }
.bars i:nth-child(4) { animation-delay: 0.45s; }
.bars i:nth-child(5) { animation-delay: 0.6s; }

@keyframes wave {
  0%,
  100% {
    height: 5px;
  }
  50% {
    height: 18px;
  }
}
</style>
