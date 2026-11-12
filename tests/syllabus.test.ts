import { describe, expect, it } from 'vitest';
import type { Assignment, AssignmentGroup, Gradebook } from '../lib/core/model';
import { compareItems, compareWeights, extractItems, extractWeights, likelyGroup, readSyllabus, similarity } from '../lib/core/syllabus';

const REF = new Date(2026, 9, 1); // 1 Oct 2026

const DOTTED = `
CS 310 Data Structures - Fall 2026
Instructor: Dr. Example        Office hours: Tue 2-3pm

Grading
Homework ................ 30%
Labs .................... 20%
Midterm Exam ............ 25%
Final Exam .............. 25%

Grading scale: A 93% - 100%, A- 90% - 92.9%
A late penalty of 10% per day applies.

Schedule
Week 3   Homework 1 due Friday, September 18
Week 7   Midterm Exam: October 14, 2026 (in class)
Week 9   No class - Fall Break, October 12
Week 12  Project proposal due 11/13
Final Exam - Tuesday, December 15 at 10:30 am
`;

const PROSE = `
Your grade is made up of the following:
- 40% : Problem Sets (weekly)
- 15% : Quizzes
- 20% : Midterm
- 25% : Final
Students must earn at least 60% on the final to pass.
Quiz 1 is on 9/24. Quiz 2 is on 10/22.
`;

describe('extractWeights', () => {
  it('reads a dotted table and ignores the grading scale and late penalty', () => {
    const r = extractWeights(DOTTED);
    expect(r.weights.map((w) => [w.name, w.weight])).toEqual([['Homework', 30], ['Labs', 20], ['Midterm Exam', 25], ['Final Exam', 25]]);
    expect(r.sum).toBe(100);
  });
  it('reads percent-first bullets and ignores a pass threshold', () => {
    const r = extractWeights(PROSE);
    expect(r.weights.map((w) => [w.name, w.weight])).toEqual([['Problem Sets', 40], ['Quizzes', 15], ['Midterm', 20], ['Final', 25]]);
  });
  it('keeps the source line for review', () => {
    expect(extractWeights(DOTTED).weights[0]?.source).toBe('Homework ................ 30%');
  });
  it('reports a sum that is not 100 instead of hiding it', () => {
    expect(extractWeights('Homework 30%\nExams 50%').sum).toBe(80);
  });
  it('finds nothing in text with no weights', () => {
    expect(extractWeights('Welcome to the course. Bring a laptop.')).toEqual({ weights: [], sum: 0 });
  });
});

describe('extractItems', () => {
  it('finds dated graded work and skips breaks', () => {
    expect(extractItems(DOTTED, REF).map((i) => [i.title, i.date])).toEqual([
      ['Homework 1', '2026-09-18'],
      ['Midterm Exam', '2026-10-14'],
      ['Project proposal', '2026-11-13'],
      ['Final Exam', '2026-12-15'],
    ]);
  });
  it('reads numeric dates in prose', () => {
    expect(extractItems(PROSE, REF).map((i) => [i.title, i.date])).toEqual([['Quiz 1', '2026-09-24'], ['Quiz 2', '2026-10-22']]);
  });
  it('picks the year nearest the reference date', () => {
    expect(extractItems('Final exam: January 12', new Date(2026, 11, 1))[0]?.date).toBe('2027-01-12');
    expect(extractItems('Final exam: December 12', new Date(2027, 0, 5))[0]?.date).toBe('2026-12-12');
  });
  it('ignores impossible dates and lines with no graded work', () => {
    expect(extractItems('Quiz on 13/45\nGuest lecture on October 3', REF)).toEqual([]);
  });
});

const a = (id: string, name: string, dueAt: string | null): Assignment => ({
  id, name, pointsPossible: 100, score: null, excused: false, countsTowardTotal: true, pendingReview: false, dueAt,
});
const g = (id: string, name: string, weight: number, assignments: Assignment[] = []): AssignmentGroup => ({
  id, name, weight, dropLowest: 0, dropHighest: 0, neverDrop: [], assignments,
});

describe('similarity', () => {
  it('treats common variants as the same thing', () => {
    expect(similarity('Homework', 'HW')).toBe(1);
    expect(similarity('Quizzes', 'Quiz')).toBe(1);
    expect(similarity('Midterm Exam', 'Midterm')).toBe(0.5);
  });
  it('never matches different numbers', () => {
    expect(similarity('Exam 1', 'Exam 2')).toBe(0);
    expect(similarity('HW3', 'Homework 3')).toBe(1);
  });
});

describe('compareWeights', () => {
  const s = readSyllabus(DOTTED, REF);
  it('flags agreement, disagreement and categories missing on either side', () => {
    const book: Gradebook = { weighted: true, groups: [g('1', 'HW', 30), g('2', 'Labs', 15), g('3', 'Midterm', 25), g('4', 'Participation', 5)] };
    expect(compareWeights(s.weights, book).map((r) => r.status)).toEqual(['match', 'differs', 'match', 'not-in-canvas', 'not-in-syllabus']);
  });
  it('says so when Canvas has no weights at all', () => {
    const book: Gradebook = { weighted: false, groups: [g('1', 'Homework', 0), g('2', 'Exams', 0)] };
    expect(compareWeights(s.weights, book).map((r) => r.status)).toEqual(['canvas-unweighted', 'not-in-canvas', 'canvas-unweighted', 'not-in-canvas']);
  });
});

describe('compareItems', () => {
  const s = readSyllabus(DOTTED, REF);
  const book: Gradebook = { weighted: true, groups: [
    g('1', 'Homework', 30, [a('h1', 'Homework 1', '2026-09-19T03:59:00Z')]),
    g('3', 'Exams', 50, [a('m', 'Midterm', '2026-10-21T16:00:00Z')]),
  ] };
  it('finds what matches, what moved and what Canvas does not have', () => {
    expect(compareItems(s.items, book).map((r) => [r.title, r.status])).toEqual([
      ['Homework 1', 'match'],
      ['Midterm Exam', 'date-differs'],
      ['Project proposal', 'not-in-canvas'],
      ['Final Exam', 'not-in-canvas'],
    ]);
  });
  it('suggests a group for work to add', () => {
    expect(likelyGroup('Final Exam', book)).toBe('3');
    expect(likelyGroup('Poster session', book)).toBe('1');
  });
});
