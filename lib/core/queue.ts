import { keptGraded } from './engine';
import type { Assignment, Course, Gradebook } from './model';
import { closedUnsubmitted, remaining } from './solver';

/**
 * The work queue: what to do next across every course, and why.
 *
 * Canvas sorts its To-Do list by due date alone. This ranks by two things a
 * student actually weighs: how soon it is due, and how much of the course grade
 * it is worth. The formula is deliberately simple and its inputs are shown on
 * every row, so the order can be checked by eye rather than trusted.
 */
export interface QueueItem {
  courseId: string;
  courseCode: string;
  assignmentId: string;
  name: string;
  dueAt: string;
  /** Negative when overdue. */
  daysLeft: number;
  /** Percent of the final course grade this one item is worth, or null if unknown. */
  impact: number | null;
  overdue: boolean;
  priority: number;
  url?: string;
}

export interface Queue {
  items: QueueItem[];
  /** Open items left out because the instructor gave them no due date. */
  undated: number;
  /** Open items due later than the window. */
  later: number;
  /** Past due with nothing left to do: waiting on a grade (on paper, in class, or not flagged missing). */
  awaiting: number;
  /** Past the lock date and never handed in. Nothing can be done about these. */
  closed: number;
  /** Items the student marked as done themselves. Kept so they can be undone. */
  done: QueueItem[];
}

const DAY = 86_400_000;
export const WINDOW_DAYS = 14;

/** Percent of the final grade riding on one open item, given everything listed today. */
export function impactOf(book: Gradebook, groupIndex: number, item: Assignment): number | null {
  const points = item.pointsPossible ?? 0;
  if (points <= 0) return null;
  const size = (i: number) => {
    const g = book.groups[i];
    if (!g) return 0;
    return [...keptGraded(g), ...g.assignments.filter(remaining)].reduce((s, a) => s + (a.pointsPossible ?? 0), 0);
  };
  if (!book.weighted) {
    const total = book.groups.reduce((s, _g, i) => s + size(i), 0);
    return total > 0 ? (points / total) * 100 : null;
  }
  const group = book.groups[groupIndex];
  if (!group || group.weight <= 0 || size(groupIndex) <= 0) return null;
  // Same rescaling as the engine: weights that sum to under 100 are scaled up.
  const inPlay = book.groups.reduce((s, g) => s + (g.weight > 0 ? g.weight : 0), 0);
  const scale = inPlay > 0 && inPlay < 100 ? 100 / inPlay : 1;
  return group.weight * scale * (points / size(groupIndex));
}

/**
 * priority = (impact + 1) / max(daysLeft, 0.5), doubled when overdue.
 * The +1 keeps tiny items from vanishing; the 0.5 floor stops division blow-ups
 * in the last hours and gives overdue work a fixed, high urgency.
 */
export function priorityOf(impact: number | null, daysLeft: number): number {
  const urgency = 1 / Math.max(daysLeft, 0.5);
  return ((impact ?? 0) + 1) * urgency * (daysLeft < 0 ? 2 : 1);
}

/** Key used for the student's own "done" marks. */
export const doneKey = (courseId: string, assignmentId: string) => `${courseId}:${assignmentId}`;

export function buildQueue(
  entries: Array<{ course: Course; book: Gradebook }>,
  now: Date,
  marked: ReadonlySet<string> = new Set(),
): Queue {
  const items: QueueItem[] = [];
  const done: QueueItem[] = [];
  let undated = 0;
  let later = 0;
  let awaiting = 0;
  let closed = 0;
  for (const { course, book } of entries) {
    book.groups.forEach((g, gi) => {
      for (const a of g.assignments) {
        // Open = will count, not graded, and not handed in yet.
        if (!remaining(a) || a.submitted || a.planned) continue;
        if (!a.dueAt) { undated++; continue; }
        const due = Date.parse(a.dueAt);
        if (!Number.isFinite(due)) { undated++; continue; }
        const daysLeft = (due - now.getTime()) / DAY;
        if (daysLeft > WINDOW_DAYS) { later++; continue; }
        if (closedUnsubmitted(a, now)) { closed++; continue; }
        // Past due is only "overdue" when there is something to hand in and the LMS
        // agrees it is missing. An in-class exam that is simply ungraded is not overdue.
        if (daysLeft < 0 && (a.expectsSubmission === false || a.missing === false)) { awaiting++; continue; }
        const impact = impactOf(book, gi, a);
        const item: QueueItem = {
          courseId: course.id, courseCode: course.code, assignmentId: a.id, name: a.name, dueAt: a.dueAt,
          daysLeft, impact, overdue: daysLeft < 0, priority: priorityOf(impact, daysLeft), url: a.url,
        };
        // Canvas cannot know about work handed in on paper or elsewhere. The student can say so.
        (marked.has(doneKey(course.id, a.id)) ? done : items).push(item);
      }
    });
  }
  items.sort((x, y) => y.priority - x.priority || x.daysLeft - y.daysLeft);
  done.sort((x, y) => x.daysLeft - y.daysLeft);
  return { items, undated, later, awaiting, closed, done };
}

/** "Overdue by 2 days", "Due in 5 hours", "Due tomorrow", "Due in 6 days". */
export function dueLabel(daysLeft: number): string {
  const abs = Math.abs(daysLeft);
  const span = abs < 1 ? `${Math.max(1, Math.round(abs * 24))} hour${Math.round(abs * 24) === 1 ? '' : 's'}`
    : `${Math.round(abs)} day${Math.round(abs) === 1 ? '' : 's'}`;
  if (daysLeft < 0) return `Overdue by ${span}`;
  if (abs >= 1 && Math.round(abs) === 1) return 'Due tomorrow';
  return `Due in ${span}`;
}
