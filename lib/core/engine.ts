import type { Assignment, Gradebook, GradeReport, GradeResult, GroupLine, OfficialTotal } from './model';

/**
 * Grade engine, slice 1. Reproduces the LMS "current grade": only graded work
 * counts, ungraded work is ignored rather than treated as zero.
 *
 *   Points-based course:  total = sum(earned) / sum(possible)
 *   Weighted course:      total = sum(groupPercent * weight) over groups that have
 *                         graded work, rescaled if those weights sum to under 100.
 *
 * Not handled yet (slice 2): drop rules. When a drop rule could change the
 * answer, the engine says so instead of guessing.
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

export interface Computation {
  percent: number | null;
  groups: GroupLine[];
  /** Why percent is null. Empty when percent is a number. */
  missing: string[];
  /** Groups whose drop rule could remove at least one graded score. */
  dropRuleGroups: string[];
}

export function compute(book: Gradebook): Computation {
  const dropRuleGroups: string[] = [];
  const groups: GroupLine[] = book.groups.map((g) => {
    const graded = g.assignments.filter(counts);
    const earned = graded.reduce((sum, a) => sum + (a.score as number), 0);
    const possible = graded.reduce((sum, a) => sum + (a.pointsPossible as number), 0);
    // A rule that drops N scores only bites once more than N scores exist.
    const dropped = g.dropLowest + g.dropHighest;
    if (dropped > 0 && graded.length > dropped) dropRuleGroups.push(g.name);
    return {
      id: g.id,
      name: g.name,
      weight: book.weighted ? g.weight : null,
      earned,
      possible,
      percent: possible > 0 ? round2((earned / possible) * 100) : null,
      gradedCount: graded.length,
      totalCount: g.assignments.filter((a) => a.countsTowardTotal).length,
    };
  });

  const withWork = groups.filter((g) => g.possible > 0);
  if (withWork.length === 0) {
    return { percent: null, groups, missing: ['Nothing has been graded yet'], dropRuleGroups };
  }

  if (!book.weighted) {
    const earned = groups.reduce((s, g) => s + g.earned, 0);
    const possible = groups.reduce((s, g) => s + g.possible, 0);
    return { percent: round2((earned / possible) * 100), groups, missing: [], dropRuleGroups };
  }

  const fullWeight = withWork.reduce((s, g) => s + (g.weight ?? 0), 0);
  if (fullWeight <= 0) {
    return {
      percent: null,
      groups,
      missing: ['The graded work sits in groups that carry 0% weight'],
      dropRuleGroups,
    };
  }
  let total = withWork.reduce((s, g) => s + (g.earned / g.possible) * (g.weight ?? 0), 0);
  // Groups with no graded work yet are left out, so scale the rest up to 100.
  // Weights above 100 mean extra credit and are left alone.
  if (fullWeight < 100) total = (total * 100) / fullWeight;
  return { percent: round2(total), groups, missing: [], dropRuleGroups };
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
    const hints = c.dropRuleGroups.map(
      (name) => `“${name}” drops scores, which this version doesn’t calculate yet`,
    );
    if (hints.length === 0) hints.push('This course uses a grading rule this version doesn’t know');
    return { kind: 'mismatch', computed: c.percent, reported: official.percent, hints };
  }

  const assumptions = [
    official.kind === 'hidden'
      ? 'Canvas hides the total for this course, so this number can’t be checked'
      : 'Canvas reports no total for this course, so this number can’t be checked',
    ...c.dropRuleGroups.map((name) => `Ignores the rule that drops scores in “${name}”`),
  ];
  return { kind: 'estimate', percent: c.percent, assumptions };
}
