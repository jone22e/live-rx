/** Mídia remota de um participante, montada a partir dos consumers do SFU. */
export interface RemoteMedia {
  peerId: string;
  /** Câmera + microfone. */
  camera: MediaStream;
  /** Tela compartilhada + áudio da tela. */
  screen: MediaStream;
  hasVideo: boolean;
  hasAudio: boolean;
  hasScreen: boolean;
}

export interface NetworkCallbacks {
  onRemoteMedia(peerId: string, media: RemoteMedia | null): void;
  onLinkState(state: RTCPeerConnectionState): void;
  /** Conexão com o servidor de mídia falhou de vez. */
  onLinkFailed(): void;
}
