import type { Gradebook } from './model';

/**
 * Syllabus reading, rule-based. Two things are pulled out of free text:
 *   1. grade weights      "Homework ........ 20%"
 *   2. dated graded work  "Midterm Exam: October 14"
 * and then compared with what Canvas has.
 *
 * Rules, not a language model, are the baseline on purpose: they are free, run
 * anywhere, behave the same every time, and can be unit-tested. Whatever does
 * the extraction, the result is a claim to be checked by the student, never a
 * fact, so every extracted line keeps the source line it came from.
 */
export interface SyllabusWeight { name: string; weight: number; source: string }
export interface SyllabusItem { title: string; date: string; source: string } // date = YYYY-MM-DD
export interface Syllabus { weights: SyllabusWeight[]; weightSum: number; items: SyllabusItem[] }

const LETTER_GRADE = /^[A-DF][+-]?$/i;
const clean = (s: string) =>
  s.replace(/\(.*?\)/g, ' ').replace(/^[\s•\-–—*·▪◦\d.)]+(?=[A-Za-z])/, '').replace(/[\s.:\-–—|…_]+$/g, '').replace(/\s+/g, ' ').trim();

export function extractWeights(text: string): { weights: SyllabusWeight[]; sum: number } {
  const found: Array<SyllabusWeight & { line: number }> = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const src = raw.trim();
    const percents = src.match(/\d{1,3}(?:\.\d+)?\s*%/g) ?? [];
    // Exactly one percent on the line; two usually means a grading scale ("A: 93% - 100%").
    if (percents.length !== 1) return;
    const weight = parseFloat(percents[0] as string);
    if (!(weight > 0 && weight <= 100)) return;
    const [before = '', after = ''] = src.split(percents[0] as string);
    const name = clean(before).length >= 2 ? clean(before) : clean(after.replace(/^[\s:\-–—]+(of\s+)?/i, ''));
    if (name.length < 2 || name.length > 60 || !/[A-Za-z]{2}/.test(name)) return;
    if (LETTER_GRADE.test(name) || /\b(or (above|below|higher|lower)|at least|minimum|below|above|penalty|deduct|late|per day|attendance rate)\b/i.test(src)) return;
    found.push({ name, weight, source: src, line });
  });
  // The weights table is a run of nearby lines. Take the run whose total is closest to 100.
  const runs: Array<typeof found> = [];
  for (const f of found) {
    const last = runs.at(-1);
    if (last && f.line - (last.at(-1) as { line: number }).line <= 3) last.push(f);
    else runs.push([f]);
  }
  const total = (r: typeof found) => r.reduce((s, f) => s + f.weight, 0);
  const best = runs.filter((r) => r.length >= 2).sort((x, y) => Math.abs(total(x) - 100) - Math.abs(total(y) - 100))[0] ?? [];
  const weights = best.map(({ name, weight, source }) => ({ name, weight, source }));
  return { weights, sum: Math.round(total(best) * 100) / 100 };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NAMED = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const GRADED = /\b(exam|midterm|final|quiz|test|homework|hw|assignment|project|paper|essay|lab|report|presentation|deliverable|problem set|pset|draft|proposal)\b/i;
const NOT_WORK = /\b(no class|holiday|break|recess|office hours|last day to (add|drop|withdraw)|withdraw|reading day)\b/i;
const pad = (n: number) => String(n).padStart(2, '0');

/** Picks the year that puts month/day closest to the reference date. */
function resolveYear(month: number, dayOfMonth: number, explicit: number | undefined, ref: Date): number {
  if (explicit) return explicit < 100 ? 2000 + explicit : explicit;
  const y = ref.getFullYear();
  return [y - 1, y, y + 1].sort((p, q) =>
    Math.abs(new Date(p, month - 1, dayOfMonth).getTime() - ref.getTime()) - Math.abs(new Date(q, month - 1, dayOfMonth).getTime() - ref.getTime()))[0] as number;
}

export function extractItems(text: string, ref: Date): SyllabusItem[] {
  const out: SyllabusItem[] = [];
  const seen = new Set<string>();
  // Lines, and sentences within a line, so "Quiz 1 is on 9/24. Quiz 2 is on 10/22." gives two items.
  for (const raw of text.split(/\r?\n|(?<=[a-z0-9)])\.\s+(?=[A-Z])/)) {
    const src = raw.trim();
    if (!GRADED.test(src) || NOT_WORK.test(src)) continue;
    let month: number, dayOfMonth: number, year: number | undefined, matched: string;
    const named = src.match(NAMED);
    const numeric = src.match(NUMERIC);
    if (named) {
      month = MONTHS.indexOf((named[1] as string).slice(0, 3).toLowerCase()) + 1;
      dayOfMonth = Number(named[2]); year = named[3] ? Number(named[3]) : undefined; matched = named[0];
    } else if (numeric) {
      month = Number(numeric[1]); dayOfMonth = Number(numeric[2]); year = numeric[3] ? Number(numeric[3]) : undefined; matched = numeric[0];
    } else continue;
    if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) continue;
    const title = clean(
      src.replace(matched, ' ')
        .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?\b\.?,?/gi, ' ')
        .replace(/\b(is |are )?(due|on|by|at|week \d+)\b:?/gi, ' ')
        .replace(/\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, ' ')
        .replace(/^[\s,;:|\-–—]+|[\s,;:|\-–—]+$/g, ''),
    );
    if (title.length < 2 || title.length > 80) continue;
    const date = `${resolveYear(month, dayOfMonth, year, ref)}-${pad(month)}-${pad(dayOfMonth)}`;
    const key = `${title.toLowerCase()}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, date, source: src });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

export function readSyllabus(text: string, ref: Date): Syllabus {
  const { weights, sum } = extractWeights(text);
  return { weights, weightSum: sum, items: extractItems(text, ref) };
}

// ---- Comparing with Canvas -------------------------------------------------

const SYNONYMS: Record<string, string> = {
  hw: 'homework', hws: 'homework', homeworks: 'homework', assignments: 'homework', assignment: 'homework',
  psets: 'homework', pset: 'homework', exams: 'exam', tests: 'exam', test: 'exam', quizzes: 'quiz',
  labs: 'lab', projects: 'project', papers: 'paper', essays: 'paper', essay: 'paper', midterms: 'midterm',
  participation: 'participation', attendance: 'participation', finals: 'final',
};
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'in', 'to', 'class', 'course']);

export function tokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').split(/\s+/)
    .filter((t) => t && !STOP.has(t)).map((t) => SYNONYMS[t] ?? t);
}

/** 0..1. Shared words over all words; different numbers ("Exam 1" vs "Exam 2") never match. */
export function similarity(x: string, y: string): number {
  const a = new Set(tokens(x));
  const b = new Set(tokens(y));
  if (a.size === 0 || b.size === 0) return 0;
  const nums = (s: Set<string>) => [...s].filter((t) => /^\d+$/.test(t)).sort().join(',');
  if (nums(a) && nums(b) && nums(a) !== nums(b)) return 0;
  const shared = [...a].filter((t) => b.has(t)).length;
  return shared / new Set([...a, ...b]).size;
}

const MATCH = 0.5;

export type WeightRow =
  | { status: 'match' | 'differs'; name: string; syllabus: number; canvasName: string; canvas: number }
  | { status: 'canvas-unweighted'; name: string; syllabus: number; canvasName: string }
  | { status: 'not-in-canvas'; name: string; syllabus: number }
  | { status: 'not-in-syllabus'; canvasName: string; canvas: number };

export function compareWeights(weights: SyllabusWeight[], book: Gradebook): WeightRow[] {
  const used = new Set<string>();
  const rows: WeightRow[] = weights.map((w) => {
    const best = book.groups.filter((g) => !used.has(g.id))
      .map((g) => ({ g, sim: similarity(w.name, g.name) })).sort((x, y) => y.sim - x.sim)[0];
    if (!best || best.sim < MATCH) return { status: 'not-in-canvas', name: w.name, syllabus: w.weight };
    used.add(best.g.id);
    if (!book.weighted) return { status: 'canvas-unweighted', name: w.name, syllabus: w.weight, canvasName: best.g.name };
    const same = Math.abs(best.g.weight - w.weight) <= 0.5;
    return { status: same ? 'match' : 'differs', name: w.name, syllabus: w.weight, canvasName: best.g.name, canvas: best.g.weight };
  });
  if (book.weighted) {
    for (const g of book.groups) {
      if (!used.has(g.id) && g.weight > 0) rows.push({ status: 'not-in-syllabus', canvasName: g.name, canvas: g.weight });
    }
  }
  return rows;
}

export type ItemRow =
  | { status: 'match'; title: string; date: string; canvasName: string }
  | { status: 'date-differs'; title: string; date: string; canvasName: string; canvasDate: string | null }
  | { status: 'not-in-canvas'; title: string; date: string };

const DAY = 86_400_000;

export function compareItems(items: SyllabusItem[], book: Gradebook): ItemRow[] {
  const all = book.groups.flatMap((g) => g.assignments.filter((a) => !a.planned));
  const used = new Set<string>();
  return items.map((it): ItemRow => {
    const want = Date.parse(`${it.date}T12:00:00`);
    const best = all.filter((a) => !used.has(a.id)).map((a) => {
      const due = a.dueAt ? Date.parse(a.dueAt) : NaN;
      const gap = Number.isFinite(due) ? Math.abs(due - want) / DAY : Infinity;
      return { a, sim: similarity(it.title, a.name), gap };
    }).filter((c) => c.sim >= MATCH).sort((x, y) => y.sim - x.sim || x.gap - y.gap)[0];
    if (!best) return { status: 'not-in-canvas', title: it.title, date: it.date };
    used.add(best.a.id);
    if (best.gap <= 1.5) return { status: 'match', title: it.title, date: it.date, canvasName: best.a.name };
    return { status: 'date-differs', title: it.title, date: it.date, canvasName: best.a.name, canvasDate: best.a.dueAt ?? null };
  });
}

/** The group a syllabus item most likely belongs to, for the "add to remaining work" default. */
export function likelyGroup(title: string, book: Gradebook): string | undefined {
  const best = book.groups.map((g) => ({ g, sim: similarity(title, g.name) })).sort((x, y) => y.sim - x.sim)[0];
  return best && best.sim > 0 ? best.g.id : book.groups[0]?.id;
}
