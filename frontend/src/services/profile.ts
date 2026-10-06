import { MAX_DISPLAY_NAME_LENGTH } from '../../../shared/protocol';

const NAME_KEY = 'screen-live:display-name';

export function normalizeDisplayName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function getStoredName(): string {
  try {
    return normalizeDisplayName(window.localStorage.getItem(NAME_KEY) ?? '');
  } catch {
    return '';
  }
}

export function storeName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, normalizeDisplayName(name));
  } catch {
    /* armazenamento indisponível (modo privado etc.) */
  }
}
