import type { Assignment, AssignmentGroup, Course, Gradebook } from '../../core/model';
import type { CourseDataSource } from '../source';

/**
 * Invented courses, one per state the UI must handle. Each `official` value was
 * worked out by hand from the scores below, so the sample data exercises the
 * real engine instead of faking its output.
 */
let n = 0;
const a = (score: number | null, pointsPossible: number): Assignment => ({
  id: `a${++n}`, name: `Item ${n}`, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false,
});
const g = (name: string, weight: number, assignments: Assignment[], dropLowest = 0): AssignmentGroup => ({
  id: name, name, weight, dropLowest, dropHighest: 0, assignments,
});

const DATA: Array<{ course: Course; book: Gradebook }> = [
  { // verified, weighted, final not graded yet: (91.6*30 + 95*20 + 87*25) / 75 = 90.97
    course: { id: 'm1', code: 'CS 310', name: 'Data Structures', term: 'Sample term', weighted: true,
      official: { kind: 'reported', percent: 90.97, letter: 'A-' } },
    book: { weighted: true, groups: [
      g('Homework', 30, [a(95, 100), a(88, 100), a(46, 50)]),
      g('Labs', 20, [a(20, 20), a(18, 20), a(null, 20)]),
      g('Midterm', 25, [a(87, 100)]),
      g('Final exam', 25, [a(null, 100)]),
    ] },
  },
  { // verified, points-based: 294 / 390 = 75.38
    course: { id: 'm2', code: 'MATH 203', name: 'Linear Algebra', term: 'Sample term', weighted: false,
      official: { kind: 'reported', percent: 75.38, letter: 'C' } },
    book: { weighted: false, groups: [
      g('Homework', 0, [a(45, 50), a(38, 50), a(41, 50)]),
      g('Quizzes', 0, [a(16, 20), a(12, 20)]),
      g('Exams', 0, [a(142, 200)]),
    ] },
  },
  { // estimate: total hidden. 88.75*0.4 + 81*0.6 = 84.1
    course: { id: 'm3', code: 'CS 330', name: 'Formal Methods and Models', term: 'Sample term', weighted: true,
      official: { kind: 'hidden' } },
    book: { weighted: true, groups: [
      g('Problem sets', 40, [a(34, 40), a(37, 40)]),
      g('Exams', 60, [a(81, 100), a(null, 100)]),
    ] },
  },
  { // mismatch: Canvas drops the lowest quiz (86.2); slice 1 does not (82.53)
    course: { id: 'm4', code: 'STAT 344', name: 'Probability and Statistics for Engineers', term: 'Sample term', weighted: true,
      official: { kind: 'reported', percent: 86.2, letter: 'B' } },
    book: { weighted: true, groups: [
      g('Quizzes', 20, [a(10, 10), a(4, 10), a(9, 10)], 1),
      g('Homework', 30, [a(47, 50)]),
      g('Exams', 50, [a(78, 100)]),
    ] },
  },
  { // insufficient: nothing graded
    course: { id: 'm5', code: 'ENGH 302', name: 'Advanced Composition', term: 'Sample term', weighted: false,
      official: { kind: 'none' } },
    book: { weighted: false, groups: [g('Essays', 0, [a(null, 100), a(null, 100)])] },
  },
];

export const mockSource: CourseDataSource = {
  label: 'Sample data',
  live: false,
  listCourses: async () => DATA.map((d) => d.course),
  getGradebook: async (course) => {
    const found = DATA.find((d) => d.course.id === course.id);
    if (!found) throw new Error('Unknown sample course');
    return found.book;
  },
};
