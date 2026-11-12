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

/** One gradable item with the student's own result on it. */
export interface Assignment {
  id: string;
  name: string;
  pointsPossible: number | null;
  /** Null when ungraded, unposted, or not submitted. Never guess a zero. */
  score: number | null;
  excused: boolean;
  /** False for practice items the instructor left out of the total. */
  countsTowardTotal: boolean;
  /** Submitted but waiting on manual grading (e.g. an essay question in a quiz). */
  pendingReview: boolean;
  /** Added by the student because it is not in the LMS yet. */
  planned?: boolean;
  /** ISO timestamp, or null/undefined when the instructor set no due date. */
  dueAt?: string | null;
  /** The student has handed it in (graded or not). */
  submitted?: boolean;
  /** Link to the item in the LMS. */
  url?: string;
  /** After this moment the LMS no longer accepts a submission. */
  lockAt?: string | null;
  /** The LMS itself flags this as past due and not handed in. */
  missing?: boolean;
  /** False for work with nothing to upload (on paper, in class). */
  expectsSubmission?: boolean;
}

export interface AssignmentGroup {
  id: string;
  name: string;
  /** Percent of the course grade. Only meaningful when the gradebook is weighted. */
  weight: number;
  dropLowest: number;
  dropHighest: number;
  /** Ids of assignments the instructor protected from being dropped. */
  neverDrop: string[];
  assignments: Assignment[];
}

export interface Gradebook {
  weighted: boolean;
  groups: AssignmentGroup[];
}

/**
 * What the engine concludes about a course total. The UI may only show a number
 * as trustworthy when kind is 'verified'.
 *  - verified: we computed it AND it equals the LMS-reported total.
 *  - estimate: we computed it but nothing exists to check it against.
 *    `assumptions` lists everything the number depends on.
 *  - mismatch: we computed it and the LMS disagrees. Our number is not shown as
 *    the grade. This is a diagnostic state: it means the engine lacks a rule.
 *  - insufficient: no number can be computed. `missing` says what is needed.
 */
export type GradeResult =
  | { kind: 'verified'; percent: number }
  | { kind: 'estimate'; percent: number; assumptions: string[] }
  | { kind: 'mismatch'; computed: number; reported: number; hints: string[] }
  | { kind: 'insufficient'; missing: string[] };

/** One row of the "how this was calculated" breakdown. */
export interface GroupLine {
  id: string;
  name: string;
  /** Null in a points-based course, where groups carry no weight. */
  weight: number | null;
  earned: number;
  possible: number;
  percent: number | null;
  gradedCount: number;
  /** Graded scores left out by the group's drop rule. */
  droppedCount: number;
  totalCount: number;
}

export interface GradeReport {
  result: GradeResult;
  groups: GroupLine[];
}
