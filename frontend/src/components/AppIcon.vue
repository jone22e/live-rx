<script setup lang="ts">
export type IconName =
  | 'mic'
  | 'mic-off'
  | 'cam'
  | 'cam-off'
  | 'call-end'
  | 'info'
  | 'people'
  | 'fullscreen'
  | 'fullscreen-exit'
  | 'volume'
  | 'copy'
  | 'close'
  | 'check'
  | 'screen';

defineProps<{ name: IconName; size?: number }>();

const paths: Record<IconName, string> = {
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
  'mic-off':
    'M19 11h-1.7a5 5 0 0 1-.4 1.9l1.4 1.4A7 7 0 0 0 19 11zM4.3 3 3 4.3 9 10.3V11a3 3 0 0 0 3 3c.4 0 .8-.1 1.1-.2l1.5 1.5A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.9V21h2v-3.1c1-.1 1.9-.5 2.7-1l3.6 3.6 1.3-1.3L4.3 3zM12 2a3 3 0 0 0-3 3v.2l6 6V5a3 3 0 0 0-3-3z',
  cam: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
  'cam-off':
    'M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.8l11.2 11.2V6.5zM3.3 2 2 3.3 4.7 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.2 0 .4 0 .5-.1l3.2 3.2 1.3-1.3L3.3 2z',
  'call-end':
    'M12 9c-1.6 0-3.1.3-4.6.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.7 1.9-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3L.3 13.1c-.2-.2-.3-.4-.3-.7 0-.3.1-.5.3-.7C3.3 8.8 7.5 7 12 7s8.7 1.8 11.7 4.7c.2.2.3.4.3.7 0 .3-.1.5-.3.7l-2.5 2.5c-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3-.8-.8-1.7-1.4-2.7-1.9-.3-.2-.6-.5-.6-.9V9.7C15.1 9.3 13.6 9 12 9z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  people:
    'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  'fullscreen-exit': 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  screen: 'M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z',
};
</script>

<template>
  <svg :width="size ?? 22" :height="size ?? 22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>
