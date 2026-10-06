import { ref } from 'vue';

const FEEDBACK_MS = 1_600;

export function useClipboard() {
  const copied = ref(false);
  let timer: number | null = null;

  async function copy(text: string): Promise<boolean> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    if (ok) {
      copied.value = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied.value = false;
      }, FEEDBACK_MS);
    }
    return ok;
  }

  return { copied, copy };
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    area.remove();
  }
  return ok;
}
