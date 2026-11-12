import type { Assignment, AssignmentGroup, Course, OfficialTotal } from '../../core/model';

/** The subset of Canvas's course JSON we read. Everything is optional on purpose:
 *  schools differ, and a missing field must degrade to "unknown", never crash. */
export interface CanvasCourse {
  id?: number | string;
  name?: string;
  course_code?: string;
  access_restricted_by_date?: boolean;
  hide_final_grades?: boolean;
  apply_assignment_group_weights?: boolean;
  term?: { name?: string } | null;
  enrollments?: Array<{
    type?: string;
    computed_current_score?: number | null;
    computed_current_grade?: string | null;
  }>;
}

export function toOfficialTotal(c: CanvasCourse): OfficialTotal {
  if (c.hide_final_grades) return { kind: 'hidden' };
  const student = c.enrollments?.find((e) => e.type === 'student');
  const score = student?.computed_current_score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return { kind: 'none' };
  return { kind: 'reported', percent: score, letter: student?.computed_current_grade ?? null };
}

/** Returns null for entries that are not a course the user takes as a student. */
export function toCourse(c: CanvasCourse): Course | null {
  if (c.id === undefined || c.access_restricted_by_date) return null;
  if (!c.enrollments?.some((e) => e.type === 'student')) return null;
  return {
    id: String(c.id),
    code: c.course_code ?? c.name ?? 'Untitled course',
    name: c.name ?? c.course_code ?? 'Untitled course',
    term: c.term?.name ?? null,
    weighted: c.apply_assignment_group_weights === true,
    official: toOfficialTotal(c),
  };
}

export interface CanvasAssignmentGroup {
  id?: number | string;
  name?: string;
  group_weight?: number | null;
  rules?: { drop_lowest?: number; drop_highest?: number; never_drop?: Array<number | string> } | null;
  assignments?: CanvasAssignment[];
}

export interface CanvasAssignment {
  id?: number | string;
  name?: string;
  points_possible?: number | null;
  due_at?: string | null;
  html_url?: string;
  omit_from_final_grade?: boolean;
  grading_type?: string;
  submission?: {
    score?: number | null;
    excused?: boolean | null;
    workflow_state?: string;
    submitted_at?: string | null;
  } | null;
}

export function toAssignment(a: CanvasAssignment): Assignment {
  const sub = a.submission ?? {};
  const score = typeof sub.score === 'number' && Number.isFinite(sub.score) ? sub.score : null;
  return {
    id: String(a.id ?? ''),
    name: a.name ?? 'Untitled',
    pointsPossible: typeof a.points_possible === 'number' ? a.points_possible : null,
    score,
    excused: sub.excused === true,
    countsTowardTotal: a.omit_from_final_grade !== true && a.grading_type !== 'not_graded',
    pendingReview: sub.workflow_state === 'pending_review',
    dueAt: a.due_at ?? null,
    submitted: Boolean(sub.submitted_at) || sub.workflow_state === 'submitted' || sub.workflow_state === 'pending_review',
    url: typeof a.html_url === 'string' && /^https?:\/\//.test(a.html_url) ? a.html_url : undefined,
  };
}

export function toGroup(g: CanvasAssignmentGroup): AssignmentGroup {
  return {
    id: String(g.id ?? ''),
    name: g.name ?? 'Assignments',
    weight: typeof g.group_weight === 'number' ? g.group_weight : 0,
    dropLowest: g.rules?.drop_lowest ?? 0,
    dropHighest: g.rules?.drop_highest ?? 0,
    neverDrop: (g.rules?.never_drop ?? []).map(String),
    assignments: (g.assignments ?? []).map(toAssignment),
  };
}
