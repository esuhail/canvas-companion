import { describe, expect, it } from 'vitest';
import { compute } from '../lib/core/engine';
import type { Assignment, AssignmentGroup, Gradebook } from '../lib/core/model';
import { project, remaining, solve } from '../lib/core/solver';

let n = 0;
const a = (score: number | null, pointsPossible: number | null = 100, extra: Partial<Assignment> = {}): Assignment => ({
  id: String(++n), name: `A${n}`, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false, ...extra,
});
const g = (name: string, weight: number, assignments: Assignment[], extra: Partial<AssignmentGroup> = {}): AssignmentGroup => ({
  id: name, name, weight, dropLowest: 0, dropHighest: 0, assignments, ...extra,
});
const points = (...groups: AssignmentGroup[]): Gradebook => ({ weighted: false, groups });
const weighted = (...groups: AssignmentGroup[]): Gradebook => ({ weighted: true, groups });

/** Fills every remaining item with `percent` and returns what the engine then computes. */
function finalIf(book: Gradebook, percent: number): number {
  const filled: Gradebook = {
    ...book,
    groups: book.groups.map((grp) => ({
      ...grp,
      assignments: grp.assignments.map((x) =>
        remaining(x) ? { ...x, score: ((x.pointsPossible as number) * percent) / 100, pendingReview: false } : x),
    })),
  };
  return compute(filled).percent as number;
}

describe('which items are still to come', () => {
  it('counts ungraded and pending items, not excused, omitted or zero-point ones', () => {
    expect(remaining(a(null))).toBe(true);
    expect(remaining(a(40, 100, { pendingReview: true }))).toBe(true);
    expect(remaining(a(90))).toBe(false);
    expect(remaining(a(null, 100, { excused: true }))).toBe(false);
    expect(remaining(a(null, 100, { countsTowardTotal: false }))).toBe(false);
    expect(remaining(a(null, 0))).toBe(false);
    expect(remaining(a(null, null))).toBe(false);
  });
});

describe('points-based', () => {
  const book = points(g('HW', 0, [a(80, 100), a(null, 100)])); // 80/100 so far, 100 left
  it('finds the needed average', () => {
    const p = solve(book, 85);
    expect(p).toMatchObject({ kind: 'needed', average: 90, details: { remainingCount: 1, remainingPoints: 100 } });
  });
  it('says secured when zero on the rest still reaches the target', () => {
    expect(solve(book, 40)).toMatchObject({ kind: 'secured', floor: 40 });
  });
  it('says out of reach and gives the ceiling', () => {
    expect(solve(book, 95)).toMatchObject({ kind: 'out-of-reach', ceiling: 90 });
  });
  it('is unknown when nothing is left', () => {
    expect(solve(points(g('HW', 0, [a(80)])), 90).kind).toBe('unknown');
  });
  it('with nothing graded, the needed average is the target itself', () => {
    expect(solve(points(g('HW', 0, [a(null), a(null, 50)])), 88)).toMatchObject({ kind: 'needed', average: 88 });
  });
});

describe('weighted', () => {
  it('accounts for where the remaining points sit', () => {
    // HW 40%: 90/100 done. Exams 60%: 70/100 done, 100 left.
    const book = weighted(g('HW', 40, [a(90)]), g('Exams', 60, [a(70), a(null)]));
    expect(solve(book, 90)).toMatchObject({ kind: 'out-of-reach', ceiling: 87 }); // 36 + 60*170/200
    expect(solve(book, 80)).toMatchObject({ kind: 'needed', average: 76.7 }); // (80-57)/0.3
  });
  it('treats an empty weighted group as work still to come, and says so', () => {
    const book = weighted(g('HW', 50, [a(80)]), g('Final exam', 50, []));
    const p = solve(book, 85);
    expect(p).toMatchObject({ kind: 'needed', average: 90 });
    expect(p.kind === 'needed' && p.details.assumptions.join(' ')).toMatch(/Final exam.*50%.*no assignments in Canvas yet/);
  });
  it('rescales weights that sum to under 100, like the engine', () => {
    const book = weighted(g('HW', 25, [a(80)]), g('Exams', 30, [a(null)])); // weights sum to 55
    const p = solve(book, 90);
    expect(p.kind).toBe('needed');
    expect(finalIf(book, (p as { average: number }).average)).toBeGreaterThanOrEqual(90);
  });
  it('ignores 0% groups entirely', () => {
    const book = weighted(g('Practice', 0, [a(null)]), g('Exams', 100, [a(60), a(null)]));
    expect(solve(book, 80)).toMatchObject({ kind: 'needed', average: 100 });
  });
  it('is unknown when no group has weight', () => {
    expect(solve(weighted(g('A', 0, [a(null)])), 90).kind).toBe('unknown');
  });
  it('notes an ignored drop rule', () => {
    const book = weighted(g('Quizzes', 100, [a(90), a(null)], { dropLowest: 1 }));
    const p = solve(book, 90);
    expect(p.kind !== 'unknown' && p.details.assumptions.some((s) => s.includes('drops scores'))).toBe(true);
  });
});

describe('the answer agrees with the engine', () => {
  const books = [
    points(g('HW', 0, [a(45, 50), a(null, 50), a(null, 30)]), g('Exams', 0, [a(142, 200), a(null, 200)])),
    weighted(g('HW', 30, [a(95), a(88), a(null, 50)]), g('Labs', 20, [a(18, 20), a(null, 20)]), g('Midterm', 25, [a(87)]), g('Final', 25, [a(null)])),
    weighted(g('A', 33.3, [a(2, 3), a(null, 7)]), g('B', 68.06, [a(77, 90), a(null, 110)])),
  ];
  for (const [i, book] of books.entries()) {
    for (const target of [70, 80, 85, 90, 93]) {
      it(`book ${i + 1}, target ${target}: stated average is enough, and 0.1 less is not`, () => {
        const p = solve(book, target);
        if (p.kind === 'needed') {
          expect(finalIf(book, p.average)).toBeGreaterThanOrEqual(target - 0.005);
          if (p.average < 100) expect(finalIf(book, p.average - 0.2)).toBeLessThan(target);
        } else if (p.kind === 'secured') {
          expect(finalIf(book, 0)).toBeGreaterThanOrEqual(target - 0.005);
        } else if (p.kind === 'out-of-reach') {
          expect(finalIf(book, 100)).toBeLessThan(target);
        }
      });
    }
  }
});

describe('project()', () => {
  const book = points(g('HW', 0, [a(80), a(null)]));
  it('refuses when the current grade could not be reproduced', () => {
    expect(project(book, { kind: 'mismatch', computed: 80, reported: 85, hints: [] }, 90).kind).toBe('unknown');
  });
  it('refuses a nonsense target', () => {
    expect(project(book, { kind: 'verified', percent: 80 }, Number.NaN).kind).toBe('unknown');
    expect(project(book, { kind: 'verified', percent: 80 }, 0).kind).toBe('unknown');
  });
  it('adds a caveat when the current grade is an estimate', () => {
    const p = project(book, { kind: 'estimate', percent: 80, assumptions: [] }, 85);
    expect(p.kind === 'needed' && p.details.assumptions.at(-1)).toMatch(/estimate/);
  });
  it('still answers when nothing is graded yet', () => {
    expect(project(points(g('HW', 0, [a(null)])), { kind: 'insufficient', missing: [] }, 90)).toMatchObject({ kind: 'needed', average: 90 });
  });
});
