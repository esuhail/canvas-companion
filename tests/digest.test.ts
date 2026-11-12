import { describe, expect, it } from 'vitest';
import { ago, diff, snapshotOf } from '../lib/core/digest';
import type { Assignment, Course, Gradebook } from '../lib/core/model';

const NOW = new Date('2026-11-10T12:00:00Z');
const a = (id: string, score: number | null, dueAt: string | null = null): Assignment => ({
  id, name: id, pointsPossible: 100, score, excused: false, countsTowardTotal: true, pendingReview: false, dueAt,
});
const course = (id: string): Course => ({ id, code: id, name: id, term: null, weighted: false, official: { kind: 'none' } });
const entry = (id: string, items: Assignment[]) => ({ course: course(id), book: { weighted: false, groups: [{ id: 'g', name: 'g', weight: 0, dropLowest: 0, dropHighest: 0, neverDrop: [], assignments: items }] } as Gradebook });

describe('snapshot', () => {
  it('holds scores and due dates only, with no names', () => {
    const s = snapshotOf([entry('C1', [a('Secret essay title', 88, '2026-11-20T00:00:00Z')])], NOW);
    expect(s.items).toEqual({ 'C1:Secret essay title': { score: 88, dueAt: '2026-11-20T00:00:00Z' } });
    expect(Object.values(s.items)[0]).not.toHaveProperty('name');
  });
});

describe('diff', () => {
  const before = snapshotOf([entry('C1', [a('hw', null), a('quiz', 70), a('lab', null, '2026-11-12T00:00:00Z')])], NOW);
  it('reports nothing on the first visit', () => {
    expect(diff(null, [entry('C1', [a('hw', 90)])])).toEqual([]);
  });
  it('reports nothing when nothing changed', () => {
    expect(diff(before, [entry('C1', [a('hw', null), a('quiz', 70), a('lab', null, '2026-11-12T00:00:00Z')])])).toEqual([]);
  });
  it('finds a new grade, a changed grade, a moved due date and a new item, grades first', () => {
    const after = [entry('C1', [a('new', null, '2026-11-30T00:00:00Z'), a('lab', null, '2026-11-14T00:00:00Z'), a('quiz', 75), a('hw', 90)])];
    expect(diff(before, after).map((c) => [c.kind, c.name])).toEqual([['graded', 'hw'], ['regraded', 'quiz'], ['due-moved', 'lab'], ['added', 'new']]);
  });
  it('does not list every item of a course it has never seen', () => {
    expect(diff(before, [entry('C1', [a('hw', null), a('quiz', 70), a('lab', null, '2026-11-12T00:00:00Z')]), entry('C2', [a('x', 50)])])).toEqual([]);
  });
  it('a grade taken back to ungraded is not reported as a new grade', () => {
    expect(diff(before, [entry('C1', [a('hw', null), a('quiz', null), a('lab', null, '2026-11-12T00:00:00Z')])])).toEqual([]);
  });
});

describe('ago', () => {
  it('reads naturally', () => {
    expect(ago('2026-11-10T11:40:00Z', NOW)).toBe('less than an hour ago');
    expect(ago('2026-11-10T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(ago('2026-11-07T12:00:00Z', NOW)).toBe('3 days ago');
  });
});
