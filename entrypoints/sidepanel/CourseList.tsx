import { useEffect, useState } from 'react';
import { grade } from '@/lib/core/engine';
import type { Course, GradeReport, GroupLine } from '@/lib/core/model';
import type { CourseDataSource } from '@/lib/integration/source';

/** The track spans 50–100%. Most course grades live there; lower values pin to the left edge. */
const LO = 50;
const TICKS = [60, 70, 80, 90];
const pos = (percent: number) => Math.min(100, Math.max(0, ((percent - LO) / (100 - LO)) * 100));
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, '');
const pts = (n: number) => String(Math.round(n * 100) / 100);

type Loaded = GradeReport | 'loading' | 'failed';

/** Plain text for a bug report: outcomes and numbers, no course or assignment names. */
export function resultsText(courses: Course[], reports: Record<string, Loaded>): string {
  return courses.map((c, i) => {
    const r = reports[c.id];
    const head = `course ${i + 1} (${c.weighted ? 'weighted' : 'points'}, canvas total ${c.official.kind})`;
    if (!r || r === 'loading' || r === 'failed') return `${head}: ${r ?? 'loading'}`;
    const res = r.result;
    const weights = r.groups.reduce((sum, g) => sum + (g.weight ?? 0), 0);
    const detail =
      res.kind === 'mismatch' ? ` computed=${res.computed} reported=${res.reported} dropRule=${res.hints.some((h) => h.includes('drops'))}`
      : res.kind === 'insufficient' ? ` (${res.missing.join('; ')})`
      : '';
    return `${head}: ${res.kind}${detail} groups=${r.groups.length} weightSum=${weights}`;
  }).join('\n');
}

/** What the row shows: one number at most, and how far it can be trusted. */
function headline(course: Course, r: Loaded): { percent: number | null; basis: 'verified' | 'reported' | 'estimate' | 'none' } {
  if (r !== 'loading' && r !== 'failed') {
    if (r.result.kind === 'verified') return { percent: r.result.percent, basis: 'verified' };
    if (r.result.kind === 'estimate') return { percent: r.result.percent, basis: 'estimate' };
    if (r.result.kind === 'mismatch') return { percent: r.result.reported, basis: 'reported' };
  }
  // Still loading, failed, or insufficient: fall back to whatever Canvas itself reports.
  return course.official.kind === 'reported'
    ? { percent: course.official.percent, basis: 'reported' }
    : { percent: null, basis: 'none' };
}

function Basis({ course, r }: { course: Course; r: Loaded }) {
  if (r === 'loading') return <p className="basis">Checking the calculation…</p>;
  if (r === 'failed') return <p className="basis">Couldn’t load the scores for this course. Refresh to try again.</p>;
  const res = r.result;
  switch (res.kind) {
    case 'verified':
      return <p className="basis verified"><span aria-hidden="true">✓ </span>Verified: our calculation matches Canvas</p>;
    case 'estimate':
      return (
        <div className="basis estimate">
          <p>Estimate</p>
          <ul>{res.assumptions.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      );
    case 'mismatch':
      return (
        <div className="basis">
          <p>Reported by Canvas. We calculated {fmt(res.computed)}%, so we can’t reproduce it yet.</p>
          <ul>{res.hints.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      );
    case 'insufficient':
      return (
        <p className="basis">
          {course.official.kind === 'hidden' ? 'Your instructor hides the total. ' : ''}
          {res.missing.join('. ')}
        </p>
      );
  }
}

function Breakdown({ groups }: { groups: GroupLine[] }) {
  const weighted = groups.some((g) => g.weight !== null);
  return (
    <details className="breakdown">
      <summary>How this is calculated</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">Group</th>
            {weighted && <th scope="col" className="r">Weight</th>}
            <th scope="col" className="r">Points</th>
            <th scope="col" className="r">Score</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} className={g.percent === null ? 'empty' : undefined}>
              <th scope="row">
                {g.name}
                <span className="count">{g.gradedCount} of {g.totalCount} graded</span>
              </th>
              {weighted && <td className="r">{pts(g.weight ?? 0)}%</td>}
              <td className="r">{g.percent === null ? '–' : `${pts(g.earned)} / ${pts(g.possible)}`}</td>
              <td className="r">{g.percent === null ? '–' : `${fmt(g.percent)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">Ungraded work is left out, the same way Canvas does it.</p>
    </details>
  );
}

function CourseRow({ course, r }: { course: Course; r: Loaded }) {
  const h = headline(course, r);
  const letter = course.official.kind === 'reported' && h.basis !== 'estimate' ? course.official.letter : null;
  return (
    <li className="course" data-basis={h.basis}>
      <div className="who">
        <span className="code">{course.code}</span>
        {course.name !== course.code && <span className="name">{course.name}</span>}
      </div>
      <div className="total">
        {h.percent === null
          ? <span className="num none">–</span>
          : <span className="num">{h.basis === 'estimate' && <small className="approx">≈</small>}{fmt(h.percent)}<small>%</small></span>}
        {letter && <span className="letter">{letter}</span>}
      </div>
      <div className={`track ${h.basis}`} aria-hidden="true">
        {TICKS.map((t) => <i key={t} className="tick" style={{ left: `${pos(t)}%` }} />)}
        {h.percent !== null && (
          <>
            <b className="fill" style={{ width: `${pos(h.percent)}%` }} />
            <b className="pin" style={{ left: `${pos(h.percent)}%` }} />
          </>
        )}
      </div>
      <Basis course={course} r={r} />
      {r !== 'loading' && r !== 'failed' && r.groups.some((g) => g.totalCount > 0) && <Breakdown groups={r.groups} />}
    </li>
  );
}

export function CourseList(props: { source: CourseDataSource; courses: Course[]; onRefresh: () => void; onLeave: () => void }) {
  const { source, courses } = props;
  const [reports, setReports] = useState<Record<string, Loaded>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    setReports({});
    (async () => {
      // One course at a time, in order: steady and gentle on the server.
      for (const course of courses) {
        let loaded: Loaded;
        try {
          loaded = grade(await source.getGradebook(course), course.official);
        } catch {
          loaded = 'failed';
        }
        if (stale) return;
        setReports((prev) => ({ ...prev, [course.id]: loaded }));
      }
    })();
    return () => { stale = true; };
  }, [source, courses]);

  const terms = [...new Set(courses.map((c) => c.term ?? ''))];
  return (
    <>
      <header className="bar">
        <span className={source.live ? 'chip live' : 'chip'}>{source.label}</span>
        <span className="spacer" />
        {source.live && (
          <button className="quiet" title="Copies outcomes and totals. No course or assignment names."
            onClick={async () => { await navigator.clipboard.writeText(resultsText(courses, reports)); setCopied(true); }}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
        )}
        {source.live && <button className="quiet" onClick={props.onRefresh}>Refresh</button>}
        <button className="quiet" onClick={props.onLeave}>{source.live ? 'Disconnect' : 'Connect Canvas'}</button>
      </header>
      <main>
        {courses.length === 0 && (
          <div className="sheet">
            <h1>No courses yet</h1>
            <p>Canvas lists no active courses for you as a student. Courses appear here once an instructor publishes them.</p>
          </div>
        )}
        {terms.map((term) => (
          <section key={term} className="term">
            {term && <h2>{term}</h2>}
            <ul className="courses">
              {courses.filter((c) => (c.term ?? '') === term).map((c) => (
                <CourseRow key={c.id} course={c} r={reports[c.id] ?? 'loading'} />
              ))}
            </ul>
          </section>
        ))}
        {courses.length > 0 && (
          <ul className="legend">
            <li><i className="key verified" />Verified: we calculated it and Canvas agrees</li>
            <li><i className="key reported" />Reported by Canvas, not reproduced</li>
            <li><i className="key estimate" />Estimate: nothing to check it against</li>
          </ul>
        )}
      </main>
    </>
  );
}
