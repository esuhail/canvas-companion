import { describe, expect, it } from 'vitest';
import { toCourse } from '../lib/integration/canvas/mappers';
import { normalizeOrigin } from '../lib/integration/canvas/probe';

const student = (extra = {}) => ({ type: 'student', ...extra });

describe('toCourse', () => {
  it('maps a reported total', () => {
    const c = toCourse({ id: 7, name: 'Data Structures', course_code: 'CS 310', apply_assignment_group_weights: true,
      term: { name: 'Fall' }, enrollments: [student({ computed_current_score: 91.4, computed_current_grade: 'A-' })] });
    expect(c).toEqual({ id: '7', code: 'CS 310', name: 'Data Structures', term: 'Fall', weighted: true,
      official: { kind: 'reported', percent: 91.4, letter: 'A-' } });
  });
  it('marks a hidden total as hidden even if a score leaks through', () => {
    const c = toCourse({ id: 1, hide_final_grades: true, enrollments: [student({ computed_current_score: 80 })] });
    expect(c?.official).toEqual({ kind: 'hidden' });
  });
  it('treats a null or missing score as no total, not zero', () => {
    expect(toCourse({ id: 1, enrollments: [student({ computed_current_score: null })] })?.official).toEqual({ kind: 'none' });
    expect(toCourse({ id: 1, enrollments: [student()] })?.official).toEqual({ kind: 'none' });
  });
  it('keeps a real zero', () => {
    expect(toCourse({ id: 1, enrollments: [student({ computed_current_score: 0 })] })?.official)
      .toEqual({ kind: 'reported', percent: 0, letter: null });
  });
  it('skips courses the user teaches, and date-restricted stubs', () => {
    expect(toCourse({ id: 1, enrollments: [{ type: 'teacher' }] })).toBeNull();
    expect(toCourse({ id: 1, access_restricted_by_date: true })).toBeNull();
  });
});

describe('normalizeOrigin', () => {
  it('accepts a bare host or a full URL', () => {
    expect(normalizeOrigin('canvas.gmu.edu')).toBe('https://canvas.gmu.edu');
    expect(normalizeOrigin(' https://canvas.gmu.edu/courses/1?x=1 ')).toBe('https://canvas.gmu.edu');
  });
  it('rejects http, empty input and non-hosts', () => {
    expect(normalizeOrigin('http://canvas.gmu.edu')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('canvas')).toBeNull();
    expect(normalizeOrigin('http://localhost:3000')).toBeNull();
    expect(normalizeOrigin('http://localhost:3000', true)).toBe('http://localhost:3000');
  });
});
