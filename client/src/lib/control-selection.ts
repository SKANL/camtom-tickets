export const CONTROL_SELECTION_KEY = 'camtom-control-selected-devices-v1';

interface SelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadControlSelection(storage: SelectionStorage | undefined = safeStorage()): string[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(CONTROL_SELECTION_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveControlSelection(ids: readonly string[], storage: SelectionStorage | undefined = safeStorage()): void {
  if (!storage) return;
  try { storage.setItem(CONTROL_SELECTION_KEY, JSON.stringify(Array.from(new Set(ids)))); } catch { /* optional preference */ }
}

function safeStorage(): SelectionStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
