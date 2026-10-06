<script setup lang="ts">
import { useClipboard } from '../../composables/useClipboard';
import AppIcon from '../AppIcon.vue';

defineProps<{
  roomName: string;
  code: string;
  shareUrl: string;
}>();

const emit = defineEmits<{ close: [] }>();

const codeClip = useClipboard();
const linkClip = useClipboard();
</script>

<template>
  <aside class="info card">
    <header>
      <h2>{{ roomName }}</h2>
      <button type="button" class="icon-btn" aria-label="Fechar" @click="emit('close')">
        <AppIcon name="close" :size="20" />
      </button>
    </header>
    <p class="muted">Compartilhe o código ou o link com quem vai participar.</p>
    <div class="code mono">{{ code }}</div>
    <div class="link-row">
      <span class="link mono">{{ shareUrl }}</span>
    </div>
    <div class="actions">
      <button type="button" class="btn btn-outline" @click="codeClip.copy(code)">
        <AppIcon :name="codeClip.copied.value ? 'check' : 'copy'" :size="18" />
        {{ codeClip.copied.value ? 'Copiado' : 'Copiar código' }}
      </button>
      <button type="button" class="btn btn-primary" @click="linkClip.copy(shareUrl)">
        <AppIcon :name="linkClip.copied.value ? 'check' : 'copy'" :size="18" />
        {{ linkClip.copied.value ? 'Copiado' : 'Copiar link' }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.info {
  position: absolute;
  left: 20px;
  bottom: 88px;
  z-index: 5;
  width: min(380px, calc(100vw - 32px));
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0;
  font-size: 16px;
}

p {
  margin: 0;
  font-size: 13.5px;
}

.icon-btn {
  width: 34px;
  height: 34px;
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
  background: var(--surface-hover);
  color: var(--text);
}

.code {
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 0.2em;
  padding-left: 0.2em;
  text-align: center;
  line-height: 1.2;
}

.link-row {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.link {
  font-size: 12.5px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 8px;
}

.actions .btn {
  flex: 1;
  min-height: 42px;
}
</style>
