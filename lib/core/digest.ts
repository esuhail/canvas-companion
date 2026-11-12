import type { Course, Gradebook } from './model';

/**
 * "What changed since I last looked?" Canvas has no single answer to that.
 *
 * A snapshot is the smallest record that can answer it: per assignment, the
 * score and the due date. No names, no course titles. Comparing the previous
 * snapshot with today's gradebooks yields the list of changes.
 */
export interface Snapshot {
  takenAt: string;
  items: Record<string, { score: number | null; dueAt: string | null }>;
}

export type Change = { courseCode: string; name: string; url?: string } & (
  | { kind: 'graded'; score: number; pointsPossible: number | null }
  | { kind: 'regraded'; from: number; to: number; pointsPossible: number | null }
  | { kind: 'due-moved'; from: string | null; to: string | null }
  | { kind: 'added'; dueAt: string | null }
);

type Entries = Array<{ course: Course; book: Gradebook }>;
const keyOf = (courseId: string, assignmentId: string) => `${courseId}:${assignmentId}`;

export function snapshotOf(entries: Entries, now: Date): Snapshot {
  const items: Snapshot['items'] = {};
  for (const { course, book } of entries) {
    for (const g of book.groups) {
      for (const a of g.assignments) items[keyOf(course.id, a.id)] = { score: a.score, dueAt: a.dueAt ?? null };
    }
  }
  return { takenAt: now.toISOString(), items };
}

/** Changes are listed grades first, since those are what students look for. */
export function diff(prev: Snapshot | null, entries: Entries): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  // A course never seen before would flood the list with "added"; skip its items.
  const knownCourses = new Set(Object.keys(prev.items).map((k) => k.slice(0, k.indexOf(':'))));
  for (const { course, book } of entries) {
    for (const g of book.groups) {
      for (const a of g.assignments) {
        const base = { courseCode: course.code, name: a.name, url: a.url };
        const before = prev.items[keyOf(course.id, a.id)];
        if (!before) {
          if (knownCourses.has(course.id)) out.push({ ...base, kind: 'added', dueAt: a.dueAt ?? null });
          continue;
        }
        if (before.score === null && a.score !== null) {
          out.push({ ...base, kind: 'graded', score: a.score, pointsPossible: a.pointsPossible });
        } else if (before.score !== null && a.score !== null && before.score !== a.score) {
          out.push({ ...base, kind: 'regraded', from: before.score, to: a.score, pointsPossible: a.pointsPossible });
        }
        if ((before.dueAt ?? null) !== (a.dueAt ?? null)) {
          out.push({ ...base, kind: 'due-moved', from: before.dueAt, to: a.dueAt ?? null });
        }
      }
    }
  }
  const order = { graded: 0, regraded: 1, 'due-moved': 2, added: 3 } as const;
  return out.sort((x, y) => order[x.kind] - order[y.kind]);
}

/** "3 hours ago", "2 days ago". */
export function ago(fromIso: string, now: Date): string {
  const hours = Math.max(0, (now.getTime() - Date.parse(fromIso)) / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 36) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}
