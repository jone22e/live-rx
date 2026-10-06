import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

interface WebkitVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
}

/** Tela cheia no container; no iOS (sem Fullscreen API) usa o fullscreen nativo do <video>. */
export function useFullscreen(container: Ref<HTMLElement | null>, video: Ref<HTMLVideoElement | null>) {
  const isFullscreen = ref(false);
  const isSupported = typeof document !== 'undefined' && (document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype);

  function sync(): void {
    isFullscreen.value = document.fullscreenElement !== null;
  }

  async function toggle(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const element = container.value;
    if (element && document.fullscreenEnabled) {
      await element.requestFullscreen();
      return;
    }
    const nativeVideo = video.value as WebkitVideoElement | null;
    nativeVideo?.webkitEnterFullscreen?.();
  }

  onMounted(() => document.addEventListener('fullscreenchange', sync));
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', sync));

  return { isFullscreen, isSupported, toggle };
}
