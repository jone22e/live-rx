<script setup lang="ts">
import { computed } from 'vue';
import { useMeeting } from '../../composables/useMeeting';
import AppIcon from '../AppIcon.vue';

/** Lista de câmeras ou microfones com o dispositivo em uso marcado. Escolher troca o dispositivo na hora. */
const props = defineProps<{ kind: 'camera' | 'mic' }>();
const emit = defineEmits<{ close: [] }>();

const meeting = useMeeting();

interface DeviceOption {
  id: string;
  label: string;
}

const options = computed<DeviceOption[]>(() => {
  const list = props.kind === 'camera' ? meeting.state.cameras : meeting.state.microphones;
  const fallback = props.kind === 'camera' ? 'Câmera' : 'Microfone';
  return list.map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
});

const title = computed(() => (props.kind === 'camera' ? 'Câmera' : 'Microfone'));
const empty = computed(() => (props.kind === 'camera' ? 'Nenhuma câmera encontrada. Permita o acesso para listar.' : 'Nenhum microfone encontrado. Permita o acesso para listar.'));

function isSelected(option: DeviceOption, index: number): boolean {
  const current = props.kind === 'camera' ? meeting.state.cameraId : meeting.state.microphoneId;
  return current ? current === option.id : index === 0;
}

function choose(option: DeviceOption): void {
  emit('close');
  void meeting.selectDevice(props.kind, option.id);
}
</script>

<template>
  <ul class="device-menu card" role="menu" :aria-label="title">
    <li class="menu-title">{{ title }}</li>
    <li v-if="options.length === 0" class="menu-empty">{{ empty }}</li>
    <li v-for="(option, index) in options" :key="option.id || index" role="menuitemradio" :aria-checked="isSelected(option, index)">
      <button type="button" :class="{ selected: isSelected(option, index) }" @click="choose(option)">
        <AppIcon v-if="isSelected(option, index)" name="check" :size="16" />
        <span v-else class="spacer" />
        {{ option.label }}
      </button>
    </li>
  </ul>
</template>

<style scoped>
.device-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 10;
  min-width: 240px;
  max-width: 320px;
  margin: 0;
  padding: 6px;
  list-style: none;
  text-align: left;
}

.menu-title {
  padding: 6px 10px 4px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.menu-empty {
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--text-muted);
}

li button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  color: var(--text);
  cursor: pointer;
}

li button:hover {
  background: var(--surface-hover);
}

li button.selected {
  color: #fff;
}

li button svg {
  color: var(--accent-hover);
  flex: 0 0 auto;
}

.spacer {
  display: inline-block;
  width: 16px;
  flex: 0 0 auto;
}
</style>
