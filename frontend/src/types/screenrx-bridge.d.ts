/**
 * Ponte opcional exposta pelo ScreenRx (app de gravação) à janela que abre a sala como gravador.
 * Só existe dentro dele; em qualquer navegador `window.screenrxMeetAudio` é undefined.
 */
interface ScreenrxMeetAudioBridge {
  /** Avisa que a captura de áudio da reunião começou (`startedAtMs` = Date.now() do início). */
  begin(startedAtMs: number, mimeType: string): void;
  /** Próximo pedaço do áudio mixado, em ordem. */
  chunk(data: ArrayBuffer): void;
  /** Captura encerrada: todos os pedaços já foram enviados. */
  end(): void;
  /** O ScreenRx pede para encerrar a captura (a gravação terminou). */
  onStopRequest(callback: () => void): void;
}

interface Window {
  screenrxMeetAudio?: ScreenrxMeetAudioBridge;
}
