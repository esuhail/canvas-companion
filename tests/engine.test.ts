import { describe, expect, it } from 'vitest';
import { compute, counts, grade, round2 } from '../lib/core/engine';
import type { Assignment, AssignmentGroup, Gradebook } from '../lib/core/model';

let n = 0;
const a = (score: number | null, pointsPossible: number | null = 100, extra: Partial<Assignment> = {}): Assignment => ({
  id: String(++n), name: `A${n}`, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false, ...extra,
});
const g = (name: string, weight: number, assignments: Assignment[], extra: Partial<AssignmentGroup> = {}): AssignmentGroup => ({
  id: name, name, weight, dropLowest: 0, dropHighest: 0, neverDrop: [], assignments, ...extra,
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

describe('drop rules', () => {
  const pct = (book: Gradebook) => compute(book).percent;
  it('drops the lowest score', () => {
    expect(pct(points(g('Q', 0, [a(100), a(50), a(90)], { dropLowest: 1 })))).toBe(95);
  });
  it('drops the highest score', () => {
    expect(pct(points(g('Q', 0, [a(100), a(50), a(90)], { dropHighest: 1 })))).toBe(70);
  });
  it('drops both ends', () => {
    expect(pct(points(g('Q', 0, [a(100), a(50), a(90), a(80)], { dropLowest: 1, dropHighest: 1 })))).toBe(85);
  });
  it('never drops the only score', () => {
    expect(pct(points(g('Q', 0, [a(40)], { dropLowest: 1 })))).toBe(40);
    expect(pct(points(g('Q', 0, [a(40), a(90)], { dropLowest: 5 })))).toBe(90);
  });
  it('skips drop-highest when the two rules would leave nothing', () => {
    expect(pct(points(g('Q', 0, [a(40), a(90)], { dropLowest: 1, dropHighest: 1 })))).toBe(90);
  });
  it('drops what helps the total most, not the lowest percent, when points differ', () => {
    // 1/5 = 20% is the lowest percent, but dropping the 60/100 exam helps more:
    // drop quiz -> 150/200 = 75; drop exam -> 91/105 = 86.67
    expect(pct(points(g('Mixed', 0, [a(1, 5), a(60, 100), a(90, 100)], { dropLowest: 1 })))).toBe(86.67);
  });
  it('honours never-drop', () => {
    const low = a(50);
    expect(pct(points(g('Q', 0, [a(100), low, a(90)], { dropLowest: 1, neverDrop: [low.id] })))).toBe(75); // drops the 90
  });
  it('ignores ungraded items when choosing what to drop', () => {
    expect(pct(points(g('Q', 0, [a(100), a(null), a(60)], { dropLowest: 1 })))).toBe(100);
  });
  it('applies inside a weighted group and reports the dropped count', () => {
    const c = compute(weighted(g('Quizzes', 20, [a(10, 10), a(4, 10), a(9, 10)], { dropLowest: 1 }), g('Exams', 80, [a(78)])));
    expect(c.percent).toBe(81.4); // 95*0.2 + 78*0.8
    expect(c.groups[0]).toMatchObject({ gradedCount: 3, droppedCount: 1, earned: 19, possible: 20 });
  });
  it('verifies against a reported total that includes the drop', () => {
    const book = points(g('Quizzes', 0, [a(100), a(50), a(90)], { dropLowest: 1 }));
    expect(grade(book, { kind: 'reported', percent: 95, letter: null }).result.kind).toBe('verified');
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
  it('is an estimate with stated assumptions when the total is hidden', () => {
    const r = grade(book, { kind: 'hidden' }).result;
    expect(r).toMatchObject({ kind: 'estimate', percent: 78 });
    expect(r.kind === 'estimate' && r.assumptions).toHaveLength(1);
  });
  it('is insufficient when nothing is graded, whatever Canvas says', () => {
    expect(grade(points(g('HW', 0, [a(null)])), { kind: 'none' }).result.kind).toBe('insufficient');
  });
  it('returns the per-group breakdown', () => {
    const lines = grade(book, { kind: 'hidden' }).groups;
    expect(lines.map((l) => [l.name, l.weight, l.percent, l.gradedCount])).toEqual([['HW', 40, 90, 1], ['Exams', 60, 70, 1]]);
  });
});

describe('drop-lowest picks the best possible set (checked by brute force)', () => {
  // Small deterministic pseudo-random generator so failures are reproducible.
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const subsets = <T,>(xs: T[], k: number): T[][] =>
    k === 0 ? [[]] : xs.length < k ? [] : [...subsets(xs.slice(1), k - 1).map((s) => [xs[0] as T, ...s]), ...subsets(xs.slice(1), k)];
  for (let trial = 0; trial < 40; trial++) {
    const size = 3 + rand(4);
    const drop = 1 + rand(2);
    const items = Array.from({ length: size }, () => { const p = [5, 10, 20, 50, 100][rand(5)] as number; return a(rand(p + 1), p); });
    it(`trial ${trial + 1}: ${size} items, drop ${drop}`, () => {
      const best = Math.max(...subsets(items, size - drop).map((s) =>
        s.reduce((t, x) => t + (x.score as number), 0) / s.reduce((t, x) => t + (x.pointsPossible as number), 0)));
      expect(compute(points(g('G', 0, items, { dropLowest: drop }))).percent).toBe(round2(best * 100));
    });
  }
});
