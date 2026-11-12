import type { Syllabus } from '../../core/syllabus';

/**
 * Optional second reader: Chrome's built-in on-device model (Prompt API).
 * Runs on the student's machine; nothing is sent anywhere.
 *
 * EXPERIMENTAL and not covered by automated tests: the model is not available
 * in the test browser. Its output is validated here and still goes through the
 * same review screen as the rule-based reader, so a bad answer cannot silently
 * become data.
 */
interface LanguageModelSession { prompt(input: string, options?: { responseConstraint?: unknown }): Promise<string>; destroy(): void }
interface LanguageModelApi { availability(): Promise<string>; create(options?: unknown): Promise<LanguageModelSession> }
const api = (): LanguageModelApi | undefined => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;

export async function onDeviceModelReady(): Promise<boolean> {
  try {
    return (await api()?.availability()) === 'available';
  } catch {
    return false;
  }
}

const SCHEMA = {
  type: 'object',
  required: ['weights', 'items'],
  properties: {
    weights: { type: 'array', items: { type: 'object', required: ['name', 'weight'], properties: { name: { type: 'string' }, weight: { type: 'number' } } } },
    items: { type: 'array', items: { type: 'object', required: ['title', 'date'], properties: { title: { type: 'string' }, date: { type: 'string' } } } },
  },
};

export async function readWithModel(text: string, today: Date): Promise<Pick<Syllabus, 'weights' | 'items'> | null> {
  const model = api();
  if (!model) return null;
  let session: LanguageModelSession | undefined;
  try {
    session = await model.create();
    const answer = await session.prompt(
      `Today is ${today.toISOString().slice(0, 10)}. From the course syllabus below, list (1) the grade weights as name and percent, ` +
        `and (2) every graded item that has a date, as title and date in YYYY-MM-DD. Only include what the text states. ` +
        `Use empty lists if nothing is stated.\n\n${text.slice(0, 12000)}`,
      { responseConstraint: SCHEMA },
    );
    const raw = JSON.parse(answer) as { weights?: Array<{ name?: unknown; weight?: unknown }>; items?: Array<{ title?: unknown; date?: unknown }> };
    const label = 'Found by the on-device model. Check it against your syllabus.';
    return {
      weights: (raw.weights ?? []).flatMap((w) =>
        typeof w.name === 'string' && typeof w.weight === 'number' && w.weight > 0 && w.weight <= 100 && w.name.trim().length >= 2
          ? [{ name: w.name.trim().slice(0, 60), weight: w.weight, source: label }] : []),
      items: (raw.items ?? []).flatMap((i) =>
        typeof i.title === 'string' && typeof i.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && Number.isFinite(Date.parse(i.date)) && i.title.trim().length >= 2
          ? [{ title: i.title.trim().slice(0, 80), date: i.date, source: label }] : []),
    };
  } catch {
    return null;
  } finally {
    session?.destroy();
  }
}
