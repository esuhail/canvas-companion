import type { Course, Gradebook } from '../core/model';

/**
 * The only thing the UI knows about where data comes from.
 * Implementations: canvas session (real), mock (sample data).
 */
export interface CourseDataSource {
  readonly label: string;
  readonly live: boolean;
  listCourses(): Promise<Course[]>;
  /** Groups, assignments and the student's own scores for one course. */
  getGradebook(course: Course): Promise<Gradebook>;
}
