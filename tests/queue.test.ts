import { describe, expect, it } from 'vitest';
import type { Assignment, AssignmentGroup, Course, Gradebook } from '../lib/core/model';
import { buildQueue, doneKey, dueLabel, impactOf, priorityOf } from '../lib/core/queue';

const NOW = new Date('2026-11-10T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const a = (id: string, score: number | null, pointsPossible: number, dueInDays: number | null, extra: Partial<Assignment> = {}): Assignment => ({
  id, name: id, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false,
  dueAt: dueInDays === null ? null : inDays(dueInDays), submitted: false, ...extra,
});
const g = (id: string, weight: number, assignments: Assignment[]): AssignmentGroup => ({
  id, name: id, weight, dropLowest: 0, dropHighest: 0, neverDrop: [], assignments,
});
const course = (id: string): Course => ({ id, code: id, name: id, term: null, weighted: true, official: { kind: 'none' } });

describe('impactOf', () => {
  it('points-based: the item’s share of all listed points', () => {
    const book: Gradebook = { weighted: false, groups: [g('All', 0, [a('x', 80, 100, null), a('y', null, 300, 3)])] };
    expect(impactOf(book, 0, book.groups[0]!.assignments[1]!)).toBe(75);
  });
  it('weighted: group weight times the item’s share of its group', () => {
    const book: Gradebook = { weighted: true, groups: [g('HW', 40, [a('h1', 90, 50, null), a('h2', null, 50, 2)]), g('Exams', 60, [a('final', null, 100, 9)])] };
    expect(impactOf(book, 0, book.groups[0]!.assignments[1]!)).toBe(20);
    expect(impactOf(book, 1, book.groups[1]!.assignments[0]!)).toBe(60);
  });
  it('rescales weights that sum to under 100', () => {
    const book: Gradebook = { weighted: true, groups: [g('HW', 25, [a('h', null, 10, 1)]), g('Ex', 25, [a('e', 50, 10, null)])] };
    expect(impactOf(book, 0, book.groups[0]!.assignments[0]!)).toBe(50);
  });
  it('is unknown in a 0% group', () => {
    const book: Gradebook = { weighted: true, groups: [g('Practice', 0, [a('p', null, 10, 1)])] };
    expect(impactOf(book, 0, book.groups[0]!.assignments[0]!)).toBeNull();
  });
});

describe('priorityOf', () => {
  it('a big item next week can outrank a tiny item tomorrow', () => {
    expect(priorityOf(30, 6)).toBeGreaterThan(priorityOf(1, 1));
  });
  it('with equal impact, sooner wins', () => {
    expect(priorityOf(5, 1)).toBeGreaterThan(priorityOf(5, 3));
  });
  it('overdue work outranks the same item due today', () => {
    expect(priorityOf(5, -2)).toBeGreaterThan(priorityOf(5, 0.2));
  });
});

describe('buildQueue', () => {
  const book: Gradebook = { weighted: true, groups: [
    g('HW', 40, [a('done', 90, 50, -10), a('tiny-tomorrow', null, 5, 1), a('handed-in', null, 50, 2, { submitted: true }), a('no-date', null, 20, null)]),
    g('Exams', 60, [a('exam-next-week', null, 100, 6), a('overdue-quiz', null, 20, -1), a('far-final', null, 100, 40)]),
  ] };
  const q = buildQueue([{ course: course('CS 1'), book }], NOW);
  it('lists only open, unsubmitted, dated work inside the window', () => {
    expect(q.items.map((i) => i.assignmentId).sort()).toEqual(['exam-next-week', 'overdue-quiz', 'tiny-tomorrow']);
    expect(q).toMatchObject({ undated: 1, later: 1, awaiting: 0, closed: 0 });
  });
  it('keeps undated work visible, biggest first', () => {
    expect(q.undatedItems.map((i) => [i.assignmentId, i.impact])).toEqual([['no-date', 6.4]]); // 40% group, 20 of its 125 listed points
  });
  it('ranks overdue first, then weighs impact against time', () => {
    expect(q.items.map((i) => i.assignmentId)).toEqual(['overdue-quiz', 'exam-next-week', 'tiny-tomorrow']);
  });
  it('merges courses into one list', () => {
    const other: Gradebook = { weighted: false, groups: [g('All', 0, [a('lab', null, 100, 0.5)])] };
    const both = buildQueue([{ course: course('CS 1'), book }, { course: course('BIO 2'), book: other }], NOW);
    expect(both.items[0]).toMatchObject({ courseCode: 'BIO 2', assignmentId: 'lab', impact: 100 });
  });
});

describe('past-due items that are not really overdue', () => {
  const mk = (extra: Partial<Assignment>) => buildQueue([{ course: course('C'), book: { weighted: false, groups: [g('All', 0, [a('x', null, 100, -3, extra)])] } }], NOW);
  it('an in-class or on-paper item is waiting on a grade', () => {
    expect(mk({ expectsSubmission: false })).toMatchObject({ items: [], awaiting: 1 });
  });
  it('an item the LMS does not flag as missing is waiting on a grade', () => {
    expect(mk({ missing: false })).toMatchObject({ items: [], awaiting: 1 });
  });
  it('an item flagged missing is overdue', () => {
    expect(mk({ missing: true }).items).toHaveLength(1);
  });
  it('a locked, never-submitted item is closed, not overdue', () => {
    expect(mk({ missing: true, lockAt: inDays(-1) })).toMatchObject({ items: [], closed: 1 });
  });
  it('a locked item with nothing to upload is still just waiting on a grade', () => {
    expect(mk({ expectsSubmission: false, lockAt: inDays(-1) })).toMatchObject({ items: [], awaiting: 1, closed: 0 });
  });
});

describe('work the student marked as done', () => {
  const book: Gradebook = { weighted: false, groups: [g('All', 0, [a('takehome', null, 50, 2), a('essay', null, 50, 4)])] };
  it('leaves the list but stays available to undo', () => {
    const q = buildQueue([{ course: course('C'), book }], NOW, new Set([doneKey('C', 'takehome')]));
    expect(q.items.map((i) => i.assignmentId)).toEqual(['essay']);
    expect(q.done.map((i) => i.assignmentId)).toEqual(['takehome']);
  });
  it('a mark for another course does not hide anything', () => {
    expect(buildQueue([{ course: course('C'), book }], NOW, new Set([doneKey('X', 'takehome')])).items).toHaveLength(2);
  });
});

describe('dueLabel', () => {
  it('reads naturally', () => {
    expect(dueLabel(-2)).toBe('Overdue by 2 days');
    expect(dueLabel(-0.1)).toBe('Overdue by 2 hours');
    expect(dueLabel(0.2)).toBe('Due in 5 hours');
    expect(dueLabel(1.2)).toBe('Due tomorrow');
    expect(dueLabel(6)).toBe('Due in 6 days');
  });
});
