import { describe, expect, it } from 'vitest';
import { compute, counts, grade, round2 } from '../lib/core/engine';
import type { Assignment, AssignmentGroup, Gradebook } from '../lib/core/model';

let n = 0;
const a = (score: number | null, pointsPossible: number | null = 100, extra: Partial<Assignment> = {}): Assignment => ({
  id: String(++n), name: `A${n}`, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false, ...extra,
});
const g = (name: string, weight: number, assignments: Assignment[], extra: Partial<AssignmentGroup> = {}): AssignmentGroup => ({
  id: name, name, weight, dropLowest: 0, dropHighest: 0, assignments, ...extra,
});
const points = (...groups: AssignmentGroup[]): Gradebook => ({ weighted: false, groups });
const weighted = (...groups: AssignmentGroup[]): Gradebook => ({ weighted: true, groups });

describe('which scores count', () => {
  it('ignores ungraded, excused, omitted, pending and pointless items', () => {
    expect(counts(a(90))).toBe(true);
    expect(counts(a(0))).toBe(true); // a real zero counts
    expect(counts(a(null))).toBe(false);
    expect(counts(a(90, 100, { excused: true }))).toBe(false);
    expect(counts(a(90, 100, { countsTowardTotal: false }))).toBe(false);
    expect(counts(a(90, 100, { pendingReview: true }))).toBe(false);
    expect(counts(a(90, null))).toBe(false);
  });
});

describe('points-based courses', () => {
  it('divides all earned points by all possible points, across groups', () => {
    const c = compute(points(g('HW', 0, [a(18, 20), a(15, 20)]), g('Exams', 0, [a(80, 100)])));
    expect(c.percent).toBe(round2((113 / 140) * 100)); // 80.71
  });
  it('does not treat ungraded work as zero', () => {
    expect(compute(points(g('HW', 0, [a(20, 20), a(null, 20)]))).percent).toBe(100);
  });
  it('counts extra-credit items worth 0 points', () => {
    expect(compute(points(g('HW', 0, [a(40, 50), a(5, 0)]))).percent).toBe(90);
  });
  it('allows totals above 100', () => {
    expect(compute(points(g('HW', 0, [a(110, 100)]))).percent).toBe(110);
  });
});

describe('weighted courses', () => {
  it('weights each group percent', () => {
    const c = compute(weighted(g('HW', 40, [a(90)]), g('Exams', 60, [a(70)])));
    expect(c.percent).toBe(78); // 90*.4 + 70*.6
  });
  it('makes a big assignment in a small group matter less than points would', () => {
    const book = [g('HW', 20, [a(10, 10)]), g('Exams', 80, [a(100, 200)])];
    expect(compute(weighted(...book)).percent).toBe(60); // 100*.2 + 50*.8
    expect(compute(points(...book)).percent).toBe(52.38); // 110/210
  });
  it('rescales when a group has no graded work yet', () => {
    const c = compute(weighted(g('HW', 40, [a(90)]), g('Final', 60, [a(null)])));
    expect(c.percent).toBe(90); // only HW exists, so HW is the whole grade for now
  });
  it('does not rescale weights that sum above 100 (extra credit)', () => {
    const c = compute(weighted(g('HW', 50, [a(80)]), g('Exams', 50, [a(80)]), g('Bonus', 10, [a(100)])));
    expect(c.percent).toBe(90); // 40 + 40 + 10
  });
  it('rounds to two decimals like Canvas', () => {
    const c = compute(weighted(g('HW', 33.3, [a(2, 3)]), g('Exams', 66.7, [a(77, 90)])));
    expect(c.percent).toBe(79.27); // 22.2 + 57.0656 = 79.2656
  });
});

describe('when no number can be given', () => {
  it('says nothing is graded', () => {
    const c = compute(points(g('HW', 0, [a(null), a(null)])));
    expect(c.percent).toBeNull();
    expect(c.missing).toEqual(['Nothing has been graded yet']);
  });
  it('says so when graded work only sits in 0% groups', () => {
    const c = compute(weighted(g('Practice', 0, [a(90)]), g('Exams', 100, [a(null)])));
    expect(c.percent).toBeNull();
    expect(c.missing[0]).toMatch(/0% weight/);
  });
  it('handles a course with no groups at all', () => {
    expect(compute(points()).percent).toBeNull();
  });
});

describe('grade(): verified, estimate, mismatch, insufficient', () => {
  const book = weighted(g('HW', 40, [a(90)]), g('Exams', 60, [a(70)])); // 78
  it('is verified only when it equals the reported total', () => {
    expect(grade(book, { kind: 'reported', percent: 78, letter: 'C+' }).result).toEqual({ kind: 'verified', percent: 78 });
  });
  it('tolerates the last rounded digit', () => {
    expect(grade(book, { kind: 'reported', percent: 78.01, letter: null }).result.kind).toBe('verified');
    expect(grade(book, { kind: 'reported', percent: 78.02, letter: null }).result.kind).toBe('mismatch');
  });
  it('is a mismatch, not a grade, when Canvas disagrees', () => {
    const r = grade(book, { kind: 'reported', percent: 81.5, letter: null }).result;
    expect(r).toMatchObject({ kind: 'mismatch', computed: 78, reported: 81.5 });
  });
  it('names the drop rule as the likely cause of a mismatch', () => {
    const dropping = points(g('Quizzes', 0, [a(100), a(50), a(90)], { dropLowest: 1 })); // ours 80, Canvas 95
    const r = grade(dropping, { kind: 'reported', percent: 95, letter: null }).result;
    expect(r.kind).toBe('mismatch');
    expect(r.kind === 'mismatch' && r.hints[0]).toMatch(/Quizzes.*drops scores/);
  });
  it('still verifies when a drop rule exists but cannot bite yet', () => {
    const early = points(g('Quizzes', 0, [a(80)], { dropLowest: 1 }));
    expect(grade(early, { kind: 'reported', percent: 80, letter: null }).result.kind).toBe('verified');
  });
  it('is an estimate with stated assumptions when the total is hidden', () => {
    const r = grade(book, { kind: 'hidden' }).result;
    expect(r).toMatchObject({ kind: 'estimate', percent: 78 });
    expect(r.kind === 'estimate' && r.assumptions).toHaveLength(1);
  });
  it('adds the ignored drop rule to an estimate’s assumptions', () => {
    const dropping = points(g('Quizzes', 0, [a(100), a(50), a(90)], { dropLowest: 1 }));
    const r = grade(dropping, { kind: 'hidden' }).result;
    expect(r.kind === 'estimate' && r.assumptions).toHaveLength(2);
  });
  it('is insufficient when nothing is graded, whatever Canvas says', () => {
    expect(grade(points(g('HW', 0, [a(null)])), { kind: 'none' }).result.kind).toBe('insufficient');
  });
  it('returns the per-group breakdown', () => {
    const lines = grade(book, { kind: 'hidden' }).groups;
    expect(lines.map((l) => [l.name, l.weight, l.percent, l.gradedCount])).toEqual([['HW', 40, 90, 1], ['Exams', 60, 70, 1]]);
  });
});
