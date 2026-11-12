import type { Transport } from './integration/canvas/transport';

/** The only thing persisted: which Canvas, and which transport worked. No course data. */
export interface Connection {
  origin: string;
  transport: Transport['id'];
}

const KEY = 'connection';

export async function loadConnection(): Promise<Connection | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as Connection | undefined) ?? null;
}

export const saveConnection = (c: Connection) => chrome.storage.local.set({ [KEY]: c });

export async function clearConnection(origin: string): Promise<void> {
  await chrome.storage.local.remove(KEY);
  // Hand the site permission back. Fails harmlessly for origins granted at install (e2e).
  await chrome.permissions.remove({ origins: [origin + '/*'] }).catch(() => false);
}

/** Targets the student typed in, keyed by course. Their own input, not Canvas data. */
const TARGETS = 'targets';
export const DEFAULT_TARGET = 90;

export async function loadTargets(): Promise<Record<string, number>> {
  const got = await chrome.storage.local.get(TARGETS);
  return (got[TARGETS] as Record<string, number> | undefined) ?? {};
}

export async function saveTarget(key: string, target: number): Promise<void> {
  await chrome.storage.local.set({ [TARGETS]: { ...(await loadTargets()), [key]: target } });
}
