import type { Course, OfficialTotal } from '../../core/model';

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
