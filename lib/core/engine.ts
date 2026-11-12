import type { Assignment, AssignmentGroup, Gradebook, GradeReport, GradeResult, GroupLine, OfficialTotal } from './model';

/**
 * Grade engine, slice 1. Reproduces the LMS "current grade": only graded work
 * counts, ungraded work is ignored rather than treated as zero.
 *
 *   Points-based course:  total = sum(earned) / sum(possible)
 *   Weighted course:      total = sum(groupPercent * weight) over groups that have
 *                         graded work, rescaled if those weights sum to under 100.
 *
 * Drop rules ("drop the lowest quiz") are applied per group before totals,
 * following the rules in Canvas's open-source grade calculator.
 */

/** Two decimals, the precision Canvas reports. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Reported totals are rounded to 2 decimals, so allow one unit of that rounding. */
const TOLERANCE = 0.011;

export function counts(a: Assignment): boolean {
  return (
    a.score !== null && !a.excused && a.countsTowardTotal && !a.pendingReview && a.pointsPossible !== null
  );
}

const ratio = (items: Assignment[], fixed: Assignment[]) => {
  const all = [...items, ...fixed];
  const possible = all.reduce((s, a) => s + (a.pointsPossible as number), 0);
  return possible > 0 ? all.reduce((s, a) => s + (a.score as number), 0) / possible : 0;
};

/**
 * Picks `keep` of `pool` so that (kept + fixed) has the best (or worst) overall
 * percentage. "Drop the lowest" is not "drop the lowest percent" when items are
 * worth different points: dropping a bad 100-point exam helps more than dropping
 * a worse 5-point quiz. The standard trick: for a guessed ratio q, rate each item
 * by score - q * possible, keep the top `keep`, recompute q from that set, and
 * repeat until the set stops changing (Dinkelbach's method).
 */
function pick(pool: Assignment[], fixed: Assignment[], keep: number, best: boolean): Assignment[] {
  if (keep >= pool.length) return pool;
  let kept = pool.slice(0, keep);
  for (let i = 0; i < 50; i++) {
    const q = ratio(kept, fixed);
    const rate = (a: Assignment) => (a.score as number) - q * (a.pointsPossible as number);
    const next = [...pool].sort((x, y) => (best ? rate(y) - rate(x) : rate(x) - rate(y))).slice(0, keep);
    const same = next.every((a) => kept.includes(a));
    kept = next;
    if (same) break;
  }
  return kept;
}

/** The graded items that still count after the group's drop rule. */
export function keptGraded(g: AssignmentGroup): Assignment[] {
  const graded = g.assignments.filter(counts);
  if (g.dropLowest <= 0 && g.dropHighest <= 0) return graded;
  const fixed = graded.filter((a) => g.neverDrop.includes(a.id));
  const pool = graded.filter((a) => !g.neverDrop.includes(a.id));
  if (pool.length === 0) return graded;
  // Canvas never drops the last remaining score, and skips "drop highest" if
  // the two rules together would leave nothing.
  const dropLowest = Math.min(g.dropLowest, pool.length - 1);
  const dropHighest = dropLowest + g.dropHighest >= pool.length ? 0 : g.dropHighest;
  const keepHighest = pool.length - dropLowest;
  const keepLowest = keepHighest - dropHighest;
  let kept: Assignment[];
  if (pool.some((a) => (a.pointsPossible as number) > 0)) {
    kept = pick(pick(pool, fixed, keepHighest, true), fixed, keepLowest, false);
  } else {
    // All extra-credit items worth 0 points: compare raw scores.
    const byScore = [...pool].sort((x, y) => (y.score as number) - (x.score as number));
    kept = byScore.slice(0, keepHighest).slice(dropHighest);
  }
  return [...fixed, ...kept];
}

export interface Computation {
  percent: number | null;
  groups: GroupLine[];
  /** Why percent is null. Empty when percent is a number. */
  missing: string[];
}

export function compute(book: Gradebook): Computation {
  const groups: GroupLine[] = book.groups.map((g) => {
    const all = g.assignments.filter(counts);
    const graded = keptGraded(g);
    const earned = graded.reduce((sum, a) => sum + (a.score as number), 0);
    const possible = graded.reduce((sum, a) => sum + (a.pointsPossible as number), 0);
    return {
      id: g.id,
      name: g.name,
      weight: book.weighted ? g.weight : null,
      earned,
      possible,
      percent: possible > 0 ? round2((earned / possible) * 100) : null,
      gradedCount: all.length,
      droppedCount: all.length - graded.length,
      totalCount: g.assignments.filter((a) => a.countsTowardTotal).length,
    };
  });

  const withWork = groups.filter((g) => g.possible > 0);
  if (withWork.length === 0) {
    return { percent: null, groups, missing: ['Nothing has been graded yet'] };
  }

  if (!book.weighted) {
    const earned = groups.reduce((s, g) => s + g.earned, 0);
    const possible = groups.reduce((s, g) => s + g.possible, 0);
    return { percent: round2((earned / possible) * 100), groups, missing: [] };
  }

  const fullWeight = withWork.reduce((s, g) => s + (g.weight ?? 0), 0);
  if (fullWeight <= 0) {
    return {
      percent: null,
      groups,
      missing: ['The graded work sits in groups that carry 0% weight']
    };
  }
  let total = withWork.reduce((s, g) => s + (g.earned / g.possible) * (g.weight ?? 0), 0);
  // Groups with no graded work yet are left out, so scale the rest up to 100.
  // Weights above 100 mean extra credit and are left alone.
  if (fullWeight < 100) total = (total * 100) / fullWeight;
  return { percent: round2(total), groups, missing: [] };
}

export function grade(book: Gradebook, official: OfficialTotal): GradeReport {
  const c = compute(book);
  return { result: conclude(c, official), groups: c.groups };
}

function conclude(c: Computation, official: OfficialTotal): GradeResult {
  if (c.percent === null) return { kind: 'insufficient', missing: c.missing };

  if (official.kind === 'reported') {
    if (Math.abs(c.percent - official.percent) <= TOLERANCE) {
      return { kind: 'verified', percent: official.percent };
    }
    const hints = ['This course uses a grading rule this version doesn’t know, such as grading periods, a late penalty or a manual override'];
    return { kind: 'mismatch', computed: c.percent, reported: official.percent, hints };
  }

  const assumptions = [
    official.kind === 'hidden'
      ? 'Canvas hides the total for this course, so this number can’t be checked'
      : 'Canvas reports no total for this course, so this number can’t be checked',
  ];
  return { kind: 'estimate', percent: c.percent, assumptions };
}
