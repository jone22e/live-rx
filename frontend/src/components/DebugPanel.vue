<script setup lang="ts">
import type { PeerStatsEntry } from '../composables/useRtcStats';

defineProps<{
  info: Array<{ key: string; value: string | number | null | undefined }>;
  peers: PeerStatsEntry[];
}>();

function show(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
</script>

<template>
  <aside class="debug mono">
    <header>debug</header>
    <dl>
      <template v-for="item in info" :key="item.key">
        <dt>{{ item.key }}</dt>
        <dd>{{ show(item.value) }}</dd>
      </template>
    </dl>
    <p v-if="peers.length === 0" class="empty">nenhuma conexão WebRTC ativa</p>
    <section v-for="peer in peers" :key="peer.id" class="peer">
      <header>peer {{ peer.id.slice(0, 8) }}</header>
      <dl>
        <dt>connectionState</dt>
        <dd>{{ peer.stats.connectionState }}</dd>
        <dt>iceConnectionState</dt>
        <dd>{{ peer.stats.iceConnectionState }}</dd>
        <dt>signalingState</dt>
        <dd>{{ peer.stats.signalingState }}</dd>
        <dt>candidate (local/remote)</dt>
        <dd>{{ show(peer.stats.localCandidateType) }} / {{ show(peer.stats.remoteCandidateType) }}</dd>
        <dt>codec</dt>
        <dd>{{ show(peer.stats.codec) }}</dd>
        <dt>bitrate</dt>
        <dd>{{ peer.stats.bitrateKbps === null ? '—' : `${peer.stats.bitrateKbps} kbps` }}</dd>
        <dt>resolution</dt>
        <dd>{{ peer.stats.width && peer.stats.height ? `${peer.stats.width}×${peer.stats.height}` : '—' }}</dd>
        <dt>fps</dt>
        <dd>{{ show(peer.stats.fps) }}</dd>
        <dt>RTT</dt>
        <dd>{{ peer.stats.rttMs === null ? '—' : `${peer.stats.rttMs} ms` }}</dd>
        <dt>packetsLost</dt>
        <dd>{{ show(peer.stats.packetsLost) }}</dd>
        <dt>bytesSent</dt>
        <dd>{{ kb(peer.stats.bytesSent) }}</dd>
        <dt>bytesReceived</dt>
        <dd>{{ kb(peer.stats.bytesReceived) }}</dd>
      </dl>
    </section>
  </aside>
</template>

<style scoped>
.debug {
  position: fixed;
  right: 12px;
  top: 12px;
  z-index: 50;
  width: min(360px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: rgba(11, 13, 18, 0.92);
  backdrop-filter: blur(8px);
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-muted);
}

header {
  margin-bottom: 6px;
  color: var(--text);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
}

dt {
  color: var(--text-faint);
}

dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.peer {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.empty {
  margin: 8px 0 0;
  color: var(--text-faint);
}
</style>
