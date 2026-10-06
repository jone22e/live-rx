/** URL do signaling: mesma origem por padrão (proxy do Vite em dev, Nginx em produção). */
export function getSignalingUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}

export function buildShareUrl(roomId: string): string {
  return `${window.location.origin}/live/${roomId}`;
}
