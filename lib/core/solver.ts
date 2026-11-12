import { counts, keptGraded, round2 } from './engine';
import type { Assignment, Gradebook, GradeResult } from './model';

/**
 * Target-score solver. Answers: "what average do I need on everything that is
 * still ungraded to finish the course at `target` percent?"
 *
 * Why this is simple algebra: if every remaining item gets the same percent p,
 * the final grade is a straight line in p:   final(p) = base + slope * p
 *   base  = the grade if every remaining item scores 0
 *   slope = how much the final grade moves per point of p
 * so the answer is p = (target - base) / slope.
 *
 * A projection is never "verified": it depends on work that does not exist yet.
 * Every answer therefore carries the assumptions it rests on.
 */
export type Projection =
  | { kind: 'needed'; average: number; details: Details }
  | { kind: 'secured'; floor: number; details: Details } // even 0% on the rest reaches the target
  | { kind: 'out-of-reach'; ceiling: number; details: Details } // even 100% on the rest falls short
  | { kind: 'unknown'; missing: string[] };

export interface Details {
  remainingCount: number;
  remainingPoints: number;
  /** Weighted groups with no items at all, counted as work still to come. */
  emptyGroups: string[];
  assumptions: string[];
}

/** Still to be graded, and will count when it is. */
export function remaining(a: Assignment): boolean {
  return (
    !counts(a) && !a.excused && a.countsTowardTotal && a.pointsPossible !== null && a.pointsPossible > 0 &&
    (a.score === null || a.pendingReview)
  );
}

interface Line { base: number; slope: number; details: Details }

/** Builds final(p) = base + slope * p, with p in percent (0–100). */
export function line(book: Gradebook): Line | { missing: string[] } {
  const assumptions = ['Canvas already lists every assignment that is still to come'];
  const emptyGroups: string[] = [];
  let remainingCount = 0;
  let remainingPoints = 0;
  // Per group: earned so far, and possible points split into graded and remaining.
  const groups = book.groups.map((g) => {
    const graded = keptGraded(g);
    const rest = g.assignments.filter(remaining);
    remainingCount += rest.length;
    const restPoints = rest.reduce((s, a) => s + (a.pointsPossible as number), 0);
    remainingPoints += restPoints;
    if (g.dropLowest + g.dropHighest > 0 && rest.length > 0) {
      assumptions.push(`“${g.name}” drops scores: what is dropped today stays dropped, and no future score is assumed dropped, so you may need a little less`);
    }
    return {
      name: g.name,
      weight: g.weight,
      earned: graded.reduce((s, a) => s + (a.score as number), 0),
      gradedPoints: graded.reduce((s, a) => s + (a.pointsPossible as number), 0),
      restPoints,
    };
  });
  const details: Details = { remainingCount, remainingPoints, emptyGroups, assumptions };

  if (!book.weighted) {
    const earned = groups.reduce((s, g) => s + g.earned, 0);
    const total = groups.reduce((s, g) => s + g.gradedPoints + g.restPoints, 0);
    if (remainingPoints === 0) return { missing: ['Canvas lists no ungraded work for this course'] };
    return { base: (earned / total) * 100, slope: remainingPoints / total, details };
  }

  let base = 0;
  let slope = 0;
  let weightInPlay = 0;
  let somethingLeft = remainingPoints > 0;
  for (const g of groups) {
    if (g.weight <= 0) continue;
    const total = g.gradedPoints + g.restPoints;
    if (total > 0) {
      base += g.weight * (g.earned / total);
      slope += g.weight * (g.restPoints / total) / 100;
    } else {
      // A weighted group with nothing in it yet, e.g. a final exam the instructor
      // has not posted. It will count, so treat the whole group as remaining work.
      slope += g.weight / 100;
      somethingLeft = true;
      emptyGroups.push(g.name);
      assumptions.push(`“${g.name}” (${round2(g.weight)}%) has no assignments in Canvas yet; assumed still to come`);
    }
    weightInPlay += g.weight;
  }
  if (weightInPlay <= 0) return { missing: ['No assignment group in this course carries any weight'] };
  if (!somethingLeft) return { missing: ['Canvas lists no ungraded work for this course'] };
  // Same rule as the engine: weights that sum to under 100 are scaled up.
  const scale = weightInPlay < 100 ? 100 / weightInPlay : 1;
  return { base: base * scale, slope: slope * scale, details };
}

export function solve(book: Gradebook, target: number): Projection {
  const l = line(book);
  if ('missing' in l) return { kind: 'unknown', missing: l.missing };
  const floor = round2(l.base);
  const ceiling = round2(l.base + l.slope * 100);
  if (floor >= target) return { kind: 'secured', floor, details: l.details };
  if (ceiling < target) return { kind: 'out-of-reach', ceiling, details: l.details };
  // Round up to one decimal so the stated average is always enough.
  const exact = (target - l.base) / l.slope;
  const average = Math.min(100, Math.ceil(exact * 10 - 1e-9) / 10);
  return { kind: 'needed', average, details: l.details };
}

/** Refuses to project from a course total the engine could not reproduce. */
export function project(book: Gradebook, current: GradeResult, target: number): Projection {
  if (current.kind === 'mismatch') {
    return { kind: 'unknown', missing: ['We can’t reproduce this course’s grade yet, so a target would be unreliable'] };
  }
  if (!Number.isFinite(target) || target <= 0) return { kind: 'unknown', missing: ['Enter a target above 0'] };
  const p = solve(book, target);
  if (p.kind !== 'unknown' && current.kind === 'estimate') {
    p.details.assumptions.push('The current grade itself is an estimate');
  }
  return p;
}
