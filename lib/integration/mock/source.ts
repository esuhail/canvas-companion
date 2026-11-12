import type { Course } from '../../core/model';
import type { CourseDataSource } from '../source';

/** Invented courses that cover every state the UI must handle. */
const SAMPLE: Course[] = [
  { id: 'm1', code: 'CS 310', name: 'Data Structures', term: 'Sample term', weighted: true,
    official: { kind: 'reported', percent: 91.4, letter: 'A-' } },
  { id: 'm2', code: 'MATH 203', name: 'Linear Algebra', term: 'Sample term', weighted: true,
    official: { kind: 'reported', percent: 78.25, letter: 'C+' } },
  { id: 'm3', code: 'CS 330', name: 'Formal Methods and Models', term: 'Sample term', weighted: false,
    official: { kind: 'hidden' } },
  { id: 'm4', code: 'STAT 344', name: 'Probability and Statistics for Engineers', term: 'Sample term', weighted: true,
    official: { kind: 'reported', percent: 84.9, letter: null } },
  { id: 'm5', code: 'ENGH 302', name: 'Advanced Composition', term: 'Sample term', weighted: false,
    official: { kind: 'none' } },
];

export const mockSource: CourseDataSource = {
  label: 'Sample data',
  live: false,
  listCourses: async () => SAMPLE,
};
