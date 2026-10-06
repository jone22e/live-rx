import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { collectStats, type RtcStatsSnapshot, type StatsSource } from '../services/stats';

export interface PeerStatsEntry {
  id: string;
  stats: RtcStatsSnapshot;
}

interface PeerSource {
  id: string;
  pc: StatsSource;
}

const POLL_INTERVAL_MS = 1_000;

/** Coleta getStats() periodicamente de todas as conexões informadas enquanto `enabled` for true. */
export function useRtcStats(getPeers: () => PeerSource[], enabled: Ref<boolean>): Ref<PeerStatsEntry[]> {
  const entries = ref<PeerStatsEntry[]>([]);
  const previous = new Map<string, RtcStatsSnapshot>();
  let timer: number | null = null;
  let polling = false;

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const peers = getPeers();
      const next: PeerStatsEntry[] = [];
      for (const peer of peers) {
        if (peer.pc.connectionState === 'closed') continue;
        try {
          const stats = await collectStats(peer.pc, previous.get(peer.id) ?? null);
          previous.set(peer.id, stats);
          next.push({ id: peer.id, stats });
        } catch {
          /* conexão pode ter fechado durante a leitura */
        }
      }
      for (const id of [...previous.keys()]) {
        if (!peers.some((p) => p.id === id)) previous.delete(id);
      }
      entries.value = next;
    } finally {
      polling = false;
    }
  }

  function stop(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    entries.value = [];
    previous.clear();
  }

  watch(
    enabled,
    (isEnabled) => {
      stop();
      if (isEnabled) {
        void poll();
        timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);
  return entries;
}
