import { describe, expect, it } from 'vitest';
import { grade } from '../lib/core/engine';
import { mockSource } from '../lib/integration/mock/source';
import { toAssignment, toGroup } from '../lib/integration/canvas/mappers';

describe('sample data runs through the real engine', () => {
  it('produces one course per state', async () => {
    const courses = await mockSource.listCourses();
    const kinds = [];
    for (const c of courses) kinds.push(grade(await mockSource.getGradebook(c), c.official).result.kind);
    expect(kinds).toEqual(['verified', 'mismatch', 'estimate', 'verified', 'insufficient']);
  });
});

describe('assignment mapping', () => {
  it('reads a graded submission', () => {
    expect(toAssignment({ id: 9, name: 'HW 1', points_possible: 20, submission: { score: 18, workflow_state: 'graded' } }))
      .toEqual({ id: '9', name: 'HW 1', pointsPossible: 20, score: 18, excused: false, countsTowardTotal: true, pendingReview: false,
        dueAt: null, submitted: false, url: undefined });
  });
  it('keeps a missing or unposted score as null, not zero', () => {
    expect(toAssignment({ id: 1, points_possible: 20 }).score).toBeNull();
    expect(toAssignment({ id: 1, points_possible: 20, submission: { score: null } }).score).toBeNull();
  });
  it('flags items left out of the total, excused work and pending review', () => {
    expect(toAssignment({ omit_from_final_grade: true }).countsTowardTotal).toBe(false);
    expect(toAssignment({ grading_type: 'not_graded' }).countsTowardTotal).toBe(false);
    expect(toAssignment({ submission: { excused: true } }).excused).toBe(true);
    expect(toAssignment({ submission: { workflow_state: 'pending_review', score: 5 } }).pendingReview).toBe(true);
  });
  it('reads due date, submitted state and a safe link', () => {
    const x = toAssignment({ id: 1, due_at: '2026-12-01T04:59:00Z', html_url: 'https://canvas.example.edu/courses/1/assignments/1', submission: { submitted_at: '2026-11-30T00:00:00Z' } });
    expect(x).toMatchObject({ dueAt: '2026-12-01T04:59:00Z', submitted: true, url: 'https://canvas.example.edu/courses/1/assignments/1' });
    expect(toAssignment({ html_url: 'javascript:alert(1)' }).url).toBeUndefined();
  });
  it('reads group weight and drop rules, defaulting to none', () => {
    expect(toGroup({ id: 3, name: 'Quizzes', group_weight: 20, rules: { drop_lowest: 1 }, assignments: [] }))
      .toEqual({ id: '3', name: 'Quizzes', weight: 20, dropLowest: 1, dropHighest: 0, neverDrop: [], assignments: [] });
    expect(toGroup({})).toMatchObject({ weight: 0, dropLowest: 0, dropHighest: 0, assignments: [] });
  });
});
