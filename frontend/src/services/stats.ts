/**
 * Leitura de RTCPeerConnection.getStats() em um formato estável para o painel de debug.
 * Funciona para o lado que envia (outbound-rtp) e o que recebe (inbound-rtp).
 */
/** O que o painel precisa de uma conexão: RTCPeerConnection ou um Transport do mediasoup-client. */
export interface StatsSource {
  getStats(): Promise<RTCStatsReport>;
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState | 'n/a';
  readonly signalingState: RTCSignalingState | 'n/a';
}

export interface RtcStatsSnapshot {
  timestamp: number;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState | 'n/a';
  signalingState: RTCSignalingState | 'n/a';
  direction: 'send' | 'receive' | null;
  codec: string | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  rttMs: number | null;
  packetsLost: number | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  bytesSent: number;
  bytesReceived: number;
  /** Bytes do fluxo de vídeo (uso interno para calcular o bitrate entre leituras). */
  videoBytes: number;
}

type StatsEntry = Record<string, unknown>;

function num(entry: StatsEntry | undefined, key: string): number | null {
  const value = entry?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(entry: StatsEntry | undefined, key: string): string | null {
  const value = entry?.[key];
  return typeof value === 'string' ? value : null;
}

export async function collectStats(pc: StatsSource, previous: RtcStatsSnapshot | null): Promise<RtcStatsSnapshot> {
  const report = await pc.getStats();
  const entries = new Map<string, StatsEntry>();
  report.forEach((value: StatsEntry, key: string) => entries.set(key, value));

  const byType = (type: string): StatsEntry[] => [...entries.values()].filter((e) => e['type'] === type);

  let bytesSent = 0;
  let bytesReceived = 0;
  for (const e of byType('outbound-rtp')) bytesSent += num(e, 'bytesSent') ?? 0;
  for (const e of byType('inbound-rtp')) bytesReceived += num(e, 'bytesReceived') ?? 0;

  // Com câmera e tela na mesma conexão, mostra o fluxo de vídeo com mais tráfego.
  const busiest = (entries: StatsEntry[], key: string): StatsEntry | undefined =>
    entries.filter((e) => e['kind'] === 'video' || e['mediaType'] === 'video').sort((a, b) => (num(b, key) ?? 0) - (num(a, key) ?? 0))[0];
  const videoOut = busiest(byType('outbound-rtp'), 'bytesSent');
  const videoIn = busiest(byType('inbound-rtp'), 'bytesReceived');
  const video = videoOut ?? videoIn;
  const direction: RtcStatsSnapshot['direction'] = videoOut ? 'send' : videoIn ? 'receive' : null;

  const codecEntry = video ? entries.get(str(video, 'codecId') ?? '') : undefined;
  const codec = str(codecEntry, 'mimeType');

  let packetsLost = num(videoIn, 'packetsLost');
  let rttSeconds: number | null = null;
  if (videoOut) {
    const remoteInbound = byType('remote-inbound-rtp').find((e) => e['kind'] === 'video' || e['localId'] === videoOut['id']);
    packetsLost = num(remoteInbound, 'packetsLost');
    rttSeconds = num(remoteInbound, 'roundTripTime');
  }

  const transport = byType('transport')[0];
  let pair = entries.get(str(transport, 'selectedCandidatePairId') ?? '');
  if (!pair) {
    pair = byType('candidate-pair').find((e) => e['state'] === 'succeeded' && (e['nominated'] === true || e['selected'] === true));
  }
  if (rttSeconds === null) rttSeconds = num(pair, 'currentRoundTripTime');
  const localCandidate = entries.get(str(pair, 'localCandidateId') ?? '');
  const remoteCandidate = entries.get(str(pair, 'remoteCandidateId') ?? '');

  // Bitrate sobre o total de vídeo (câmera + tela), estável mesmo quando o fluxo "mais ocupado" muda.
  const isVideo = (e: StatsEntry) => e['kind'] === 'video' || e['mediaType'] === 'video';
  const videoBytes = videoOut
    ? byType('outbound-rtp').filter(isVideo).reduce((sum, e) => sum + (num(e, 'bytesSent') ?? 0), 0)
    : byType('inbound-rtp').filter(isVideo).reduce((sum, e) => sum + (num(e, 'bytesReceived') ?? 0), 0);
  const timestamp = performance.now();
  let bitrateKbps: number | null = null;
  if (previous && timestamp > previous.timestamp) {
    const deltaBytes = videoBytes - previous.videoBytes;
    const deltaSeconds = (timestamp - previous.timestamp) / 1000;
    if (deltaBytes >= 0) bitrateKbps = Math.round((deltaBytes * 8) / 1000 / deltaSeconds);
  }

  return {
    timestamp,
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    signalingState: pc.signalingState,
    direction,
    codec,
    bitrateKbps,
    width: num(video, 'frameWidth'),
    height: num(video, 'frameHeight'),
    fps: num(video, 'framesPerSecond'),
    rttMs: rttSeconds === null ? null : Math.round(rttSeconds * 1000),
    packetsLost,
    localCandidateType: str(localCandidate, 'candidateType'),
    remoteCandidateType: str(remoteCandidate, 'candidateType'),
    bytesSent,
    bytesReceived,
    videoBytes,
  };
}
