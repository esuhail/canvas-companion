import { compute } from './engine';
import type { Assignment, Gradebook, GradeResult } from './model';
import { project, remaining, type Projection } from './solver';

/**
 * A scenario is the student's own "what if" layered on top of the real gradebook:
 *  - whatIf:  a pretend score for an item that is not graded yet
 *  - planned: an item that is not in the LMS yet (an unposted final, say)
 *
 * The real gradebook is never modified. applyScenario() returns a copy, and the
 * engine and solver run on that copy unchanged. That is the payoff of keeping
 * them pure: a new feature is a data transformation, not new grading logic.
 */
export interface PlannedItem {
  id: string;
  groupId: string;
  name: string;
  pointsPossible: number;
}

export interface Scenario {
  whatIf: Record<string, number>;
  planned: PlannedItem[];
}

export const EMPTY_SCENARIO: Scenario = { whatIf: {}, planned: [] };

/** Adds planned items only: the list of everything still open, before any what-if. */
export function withPlanned(book: Gradebook, planned: PlannedItem[]): Gradebook {
  return {
    ...book,
    groups: book.groups.map((g) => ({
      ...g,
      assignments: [
        ...g.assignments,
        ...planned
          .filter((p) => p.groupId === g.id && p.pointsPossible > 0)
          .map((p): Assignment => ({
            id: p.id, name: p.name, pointsPossible: p.pointsPossible, score: null,
            excused: false, countsTowardTotal: true, pendingReview: false, planned: true,
          })),
      ],
    })),
  };
}

export function applyScenario(book: Gradebook, s: Scenario): Gradebook {
  const base = withPlanned(book, s.planned);
  return {
    ...base,
    groups: base.groups.map((g) => ({
      ...g,
      assignments: g.assignments.map((a) => {
        const pretend = s.whatIf[a.id];
        // A what-if never overrides a real grade: it only fills an open item.
        if (pretend === undefined || !Number.isFinite(pretend) || pretend < 0 || !remaining(a)) return a;
        return { ...a, score: pretend, pendingReview: false };
      }),
    })),
  };
}

export interface OpenItem {
  id: string;
  name: string;
  pointsPossible: number;
  groupId: string;
  groupName: string;
  planned: boolean;
}

/** Every item still to be graded, real or planned, in gradebook order. */
export function openItems(book: Gradebook, planned: PlannedItem[]): OpenItem[] {
  return withPlanned(book, planned).groups.flatMap((g) =>
    g.assignments.filter(remaining).map((a) => ({
      id: a.id, name: a.name, pointsPossible: a.pointsPossible as number,
      groupId: g.id, groupName: g.name, planned: a.planned === true,
    })),
  );
}

export type Plan =
  | Projection
  /** Every open item has a what-if score, so there is nothing left to solve for. */
  | { kind: 'final'; percent: number; reaches: boolean; assumptions: string[] };

export function plan(book: Gradebook, current: GradeResult, target: number, s: Scenario): Plan {
  const open = openItems(book, s.planned);
  const filled = open.filter((i) => Number.isFinite(s.whatIf[i.id]) && (s.whatIf[i.id] as number) >= 0);
  const plannedCount = open.filter((i) => i.planned).length;
  const extra: string[] = [];
  if (filled.length > 0) extra.push(`Counts the ${filled.length} what-if score${filled.length === 1 ? '' : 's'} you entered as if real`);
  if (plannedCount > 0) extra.push(`Includes ${plannedCount} item${plannedCount === 1 ? '' : 's'} you added that ${plannedCount === 1 ? 'is' : 'are'} not in Canvas`);

  const scenarioBook = applyScenario(book, s);
  const p = project(scenarioBook, current, target);
  if (p.kind !== 'unknown') {
    p.details.assumptions.push(...extra);
    return p;
  }
  // Nothing left to solve for. If that is because the student filled everything in,
  // answer the question they are really asking: where would that leave me?
  if (current.kind !== 'mismatch' && filled.length > 0 && filled.length === open.length) {
    const percent = compute(scenarioBook).percent;
    if (percent !== null && Number.isFinite(target) && target > 0) {
      return { kind: 'final', percent, reaches: percent >= target, assumptions: extra };
    }
  }
  return p;
}
