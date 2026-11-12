import type { Snapshot } from './core/digest';
import type { Scenario } from './core/scenario';
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
  // Disconnect forgets everything this extension stored: connection, targets,
  // what-ifs, added work, and the snapshot used for "what changed".
  await chrome.storage.local.clear();
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

/** What-if scores and planned items the student typed in, keyed by course. */
const SCENARIOS = 'scenarios';

export async function loadScenarios(): Promise<Record<string, Scenario>> {
  const got = await chrome.storage.local.get(SCENARIOS);
  return (got[SCENARIOS] as Record<string, Scenario> | undefined) ?? {};
}

export async function saveScenario(key: string, scenario: Scenario): Promise<void> {
  await chrome.storage.local.set({ [SCENARIOS]: { ...(await loadScenarios()), [key]: scenario } });
}

/** Scores and due dates from the last visit, for "what changed". No names. */
const SNAPSHOT = 'snapshot';

export async function loadSnapshot(sourceKey: string): Promise<Snapshot | null> {
  const k = `${SNAPSHOT}:${sourceKey}`;
  const got = await chrome.storage.local.get(k);
  return (got[k] as Snapshot | undefined) ?? null;
}

export const saveSnapshot = (sourceKey: string, snapshot: Snapshot) =>
  chrome.storage.local.set({ [`${SNAPSHOT}:${sourceKey}`]: snapshot });
