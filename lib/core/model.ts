/**
 * Domain model. Nothing in lib/core knows that Canvas, Chrome or React exist.
 * Integrations map their own data into these shapes, so swapping the integration
 * (session API today, something else later) does not touch the engine or the UI.
 */

/** What the LMS itself says the course total is. */
export type OfficialTotal =
  | { kind: 'reported'; percent: number; letter: string | null }
  | { kind: 'hidden' } // instructor hides totals from students
  | { kind: 'none' }; // visible, but nothing is graded yet

export interface Course {
  id: string;
  code: string;
  name: string;
  term: string | null;
  /** True when the course grades by weighted assignment groups. */
  weighted: boolean;
  official: OfficialTotal;
}

/**
 * Contract for the grade engine (milestone 2). Defined now so the UI and the
 * engine agree on the three states before either is written:
 *  - verified: we computed it AND it matches the LMS-reported total.
 *  - estimate: we computed it, but could not check it (or it relies on inputs
 *    the student typed in). `assumptions` says exactly what was assumed.
 *  - insufficient: we refuse to show a number. `missing` says what is needed.
 */
export type GradeResult =
  | { kind: 'verified'; percent: number; checkedAgainst: number }
  | { kind: 'estimate'; percent: number; assumptions: string[] }
  | { kind: 'insufficient'; missing: string[] };
