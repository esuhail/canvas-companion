import { describe, expect, it } from 'vitest';
import { compute } from '../lib/core/engine';
import type { Assignment, AssignmentGroup, Gradebook, GradeResult } from '../lib/core/model';
import { applyScenario, EMPTY_SCENARIO, openItems, plan } from '../lib/core/scenario';

const a = (id: string, score: number | null, pointsPossible = 100): Assignment => ({
  id, name: id, pointsPossible, score, excused: false, countsTowardTotal: true, pendingReview: false,
});
const g = (id: string, weight: number, assignments: Assignment[], extra: Partial<AssignmentGroup> = {}): AssignmentGroup => ({
  id, name: id, weight, dropLowest: 0, dropHighest: 0, neverDrop: [], assignments, ...extra,
});
const verified: GradeResult = { kind: 'verified', percent: 0 };
// HW 40%: 90/100. Exams 60%: midterm 70/100, final ungraded.
const book: Gradebook = { weighted: true, groups: [g('HW', 40, [a('hw1', 90)]), g('Exams', 60, [a('mid', 70), a('final', null)])] };

describe('applyScenario', () => {
  it('leaves the real gradebook untouched', () => {
    const before = JSON.stringify(book);
    applyScenario(book, { whatIf: { final: 95 }, planned: [{ id: 'p1', groupId: 'HW', name: 'HW 2', pointsPossible: 50 }] });
    expect(JSON.stringify(book)).toBe(before);
  });
  it('fills an open item with a what-if score', () => {
    expect(compute(applyScenario(book, { whatIf: { final: 100 }, planned: [] })).percent).toBe(87); // 36 + 60*170/200
  });
  it('never overrides a real grade', () => {
    expect(compute(applyScenario(book, { whatIf: { mid: 100 }, planned: [] })).percent).toBe(compute(book).percent);
  });
  it('ignores negative and non-numeric what-ifs', () => {
    expect(compute(applyScenario(book, { whatIf: { final: -5 }, planned: [] })).percent).toBe(compute(book).percent);
    expect(compute(applyScenario(book, { whatIf: { final: Number.NaN }, planned: [] })).percent).toBe(compute(book).percent);
  });
  it('adds planned items as open work in their group, and ignores unknown groups', () => {
    const planned = [
      { id: 'p1', groupId: 'HW', name: 'HW 2', pointsPossible: 50 },
      { id: 'p2', groupId: 'nope', name: 'Lost', pointsPossible: 50 },
    ];
    expect(openItems(book, planned).map((i) => [i.id, i.groupName, i.planned])).toEqual([['p1', 'HW', true], ['final', 'Exams', false]]);
  });
});

describe('closed, never-submitted work', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const past = '2026-11-01T00:00:00Z';
  const b: Gradebook = { weighted: false, groups: [g('All', 0, [a('done', 80), { ...a('closed', null), lockAt: past, missing: true }, a('open', null)])] };
  it('counts as zero in the projection and is declared', () => {
    // 80 earned of 300 total; 100 still open. For 60%: (180 - 80) / 100 = 100.
    const p = plan(b, verified, 60, EMPTY_SCENARIO, now);
    expect(p).toMatchObject({ kind: 'needed', average: 100, details: { remainingCount: 1 } });
    expect(p.kind === 'needed' && p.details.assumptions.join(' ')).toMatch(/1 closed item you did not submit as zero/);
    expect(plan(b, verified, 61, EMPTY_SCENARIO, now)).toMatchObject({ kind: 'out-of-reach', ceiling: 60 });
  });
  it('is not offered as a what-if', () => {
    expect(openItems(b, [], now).map((i) => i.id)).toEqual(['open']);
  });
  it('does not touch on-paper work or work that was handed in', () => {
    const paper: Gradebook = { weighted: false, groups: [g('All', 0, [{ ...a('exam', null), lockAt: past, expectsSubmission: false }, { ...a('essay', null), lockAt: past, submitted: true }])] };
    expect(openItems(paper, [], now)).toHaveLength(2);
  });
});

describe('plan', () => {
  it('with no scenario, equals the plain solver answer', () => {
    expect(plan(book, verified, 80, EMPTY_SCENARIO)).toMatchObject({ kind: 'needed', average: 76.7, details: { remainingCount: 1 } });
  });
  it('a planned item changes what is needed and is declared', () => {
    const p = plan(book, verified, 80, { whatIf: {}, planned: [{ id: 'p1', groupId: 'HW', name: 'HW 2', pointsPossible: 100 }] });
    // base = 40*90/200 + 60*70/200 = 39; slope = (40*0.5 + 60*0.5)/100 = 0.5; (80-39)/0.5 = 82
    expect(p).toMatchObject({ kind: 'needed', average: 82, details: { remainingCount: 2 } });
    expect(p.kind === 'needed' && p.details.assumptions.join(' ')).toMatch(/1 item you added that is not in Canvas/);
  });
  it('a what-if on one item gives the answer for the others', () => {
    const planned = [{ id: 'p1', groupId: 'HW', name: 'HW 2', pointsPossible: 100 }];
    const p = plan(book, verified, 80, { whatIf: { p1: 100 }, planned });
    // HW becomes 190/200 = 95 -> 38. Need 42 from exams: (70 + x)/200*60 = 42 -> x = 70
    expect(p).toMatchObject({ kind: 'needed', average: 70, details: { remainingCount: 1 } });
    expect(p.kind === 'needed' && p.details.assumptions.join(' ')).toMatch(/1 what-if score you entered/);
  });
  it('when every open item has a what-if, reports where that leaves you', () => {
    expect(plan(book, verified, 85, { whatIf: { final: 100 }, planned: [] })).toMatchObject({ kind: 'final', percent: 87, reaches: true });
    expect(plan(book, verified, 90, { whatIf: { final: 100 }, planned: [] })).toMatchObject({ kind: 'final', percent: 87, reaches: false });
  });
  it('lets a points-based course account for an unposted final', () => {
    const pts: Gradebook = { weighted: false, groups: [g('All', 0, [a('x', 80)])] };
    expect(plan(pts, verified, 85, EMPTY_SCENARIO).kind).toBe('unknown');
    expect(plan(pts, verified, 85, { whatIf: {}, planned: [{ id: 'p', groupId: 'All', name: 'Final', pointsPossible: 100 }] }))
      .toMatchObject({ kind: 'needed', average: 90 });
  });
  it('a planned item in an empty weighted group replaces the "assumed still to come" guess', () => {
    const b: Gradebook = { weighted: true, groups: [g('HW', 50, [a('h', 80)]), g('Final', 50, [])] };
    const guess = plan(b, verified, 85, EMPTY_SCENARIO);
    expect(guess.kind === 'needed' && guess.details.emptyGroups).toEqual(['Final']);
    const real = plan(b, verified, 85, { whatIf: {}, planned: [{ id: 'p', groupId: 'Final', name: 'Final', pointsPossible: 200 }] });
    expect(real).toMatchObject({ kind: 'needed', average: 90, details: { emptyGroups: [], remainingCount: 1 } });
  });
  it('still refuses when the course grade could not be reproduced', () => {
    const mismatch: GradeResult = { kind: 'mismatch', computed: 1, reported: 2, hints: [] };
    expect(plan(book, mismatch, 80, { whatIf: { final: 100 }, planned: [] }).kind).toBe('unknown');
  });
});
