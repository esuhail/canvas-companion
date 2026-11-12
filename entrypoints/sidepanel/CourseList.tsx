import { useEffect, useState } from 'react';
import { grade } from '@/lib/core/engine';
import type { Course, Gradebook, GradeReport, GroupLine } from '@/lib/core/model';
import { project } from '@/lib/core/solver';
import { DEFAULT_TARGET, loadTargets, saveTarget } from '@/lib/settings';
import type { CourseDataSource } from '@/lib/integration/source';

/** The track spans 50–100%. Most course grades live there; lower values pin to the left edge. */
const LO = 50;
const TICKS = [60, 70, 80, 90];
const pos = (percent: number) => Math.min(100, Math.max(0, ((percent - LO) / (100 - LO)) * 100));
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, '');
const pts = (n: number) => String(Math.round(n * 100) / 100);

type Loaded = (GradeReport & { book: Gradebook }) | 'loading' | 'failed';

/** Plain text for a bug report: outcomes and numbers, no course or assignment names. */
export function resultsText(courses: Course[], reports: Record<string, Loaded>, targetOf: (c: Course) => number): string {
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
    const p = project(r.book, res, targetOf(c));
    const solver = p.kind === 'unknown' ? `unknown (${p.missing.join('; ')})`
      : `${p.kind}${p.kind === 'needed' ? ` avg=${p.average}` : p.kind === 'secured' ? ` floor=${p.floor}` : ` ceiling=${p.ceiling}`}` +
        ` remaining=${p.details.remainingCount} items/${p.details.remainingPoints} pts assumptions=${p.details.assumptions.length}`;
    return `${head}: ${res.kind}${detail} groups=${r.groups.length} weightSum=${weights}\n  target ${targetOf(c)}: ${solver}`;
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

const QUICK = [70, 80, 90];

function Target(props: { course: Course; r: GradeReport & { book: Gradebook }; target: number; onTarget: (t: number) => void }) {
  const { r, target } = props;
  const [draft, setDraft] = useState(String(target));
  useEffect(() => setDraft(String(target)), [target]);
  const p = project(r.book, r.result, target);
  const id = `target-${props.course.id}`;
  const commit = (raw: string) => {
    const t = Number(raw);
    if (Number.isFinite(t) && t > 0 && t <= 150) props.onTarget(Math.round(t * 10) / 10);
    else setDraft(String(target));
  };
  const rest = p.kind === 'unknown' ? '' :
    `the ${p.details.remainingCount === 0 ? 'work still to come' : `${p.details.remainingCount} ungraded item${p.details.remainingCount === 1 ? '' : 's'}`}` +
    (p.details.remainingPoints > 0 ? ` (${pts(p.details.remainingPoints)} points)` : '');
  return (
    <section className={`target ${p.kind}`} aria-label={`Target for ${props.course.code}`}>
      <div className="aim">
        <label htmlFor={id}>To finish with</label>
        <span className="field">
          <input id={id} inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); }} />
          <span aria-hidden="true">%</span>
        </span>
        <span className="quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className="quiet" aria-pressed={q === target} onClick={() => props.onTarget(q)}>{q}</button>
          ))}
        </span>
      </div>
      {p.kind === 'needed' && <p className="answer">You need an average of <strong>{fmt(p.average)}%</strong> on {rest}.</p>}
      {p.kind === 'secured' && <p className="answer">Already secured. Even 0% on {rest} leaves you at <strong>{fmt(p.floor)}%</strong>.</p>}
      {p.kind === 'out-of-reach' && <p className="answer">Out of reach with what Canvas lists. 100% on {rest} gets you to <strong>{fmt(p.ceiling)}%</strong>.</p>}
      {p.kind === 'unknown' && <p className="answer">{p.missing.join('. ')}.</p>}
      {p.kind !== 'unknown' && (
        <details className="assume">
          <summary>This projection assumes {p.details.assumptions.length} thing{p.details.assumptions.length === 1 ? '' : 's'}</summary>
          <ul>{p.details.assumptions.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function CourseRow({ course, r, target, onTarget }: { course: Course; r: Loaded; target: number; onTarget: (t: number) => void }) {
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
        {target >= LO && target <= 100 && <b className="goal" style={{ left: `${pos(target)}%` }} />}
        {h.percent !== null && (
          <>
            <b className="fill" style={{ width: `${pos(h.percent)}%` }} />
            <b className="pin" style={{ left: `${pos(h.percent)}%` }} />
          </>
        )}
      </div>
      <Basis course={course} r={r} />
      {r !== 'loading' && r !== 'failed' && <Target course={course} r={r} target={target} onTarget={onTarget} />}
      {r !== 'loading' && r !== 'failed' && r.groups.some((g) => g.totalCount > 0) && <Breakdown groups={r.groups} />}
    </li>
  );
}

export function CourseList(props: { source: CourseDataSource; courses: Course[]; onRefresh: () => void; onLeave: () => void }) {
  const { source, courses } = props;
  const [reports, setReports] = useState<Record<string, Loaded>>({});
  const [copied, setCopied] = useState(false);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const key = (c: Course) => `${source.label}:${c.id}`;
  useEffect(() => { loadTargets().then(setTargets); }, []);
  const setTarget = (c: Course, t: number) => {
    setTargets((prev) => ({ ...prev, [key(c)]: t }));
    void saveTarget(key(c), t);
  };

  useEffect(() => {
    let stale = false;
    setReports({});
    (async () => {
      // One course at a time, in order: steady and gentle on the server.
      for (const course of courses) {
        let loaded: Loaded;
        try {
          const book = await source.getGradebook(course);
          loaded = { ...grade(book, course.official), book };
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
            onClick={async () => { await navigator.clipboard.writeText(resultsText(courses, reports, (c) => targets[key(c)] ?? DEFAULT_TARGET)); setCopied(true); }}>
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
                <CourseRow key={c.id} course={c} r={reports[c.id] ?? 'loading'}
                  target={targets[key(c)] ?? DEFAULT_TARGET} onTarget={(t) => setTarget(c, t)} />
              ))}
            </ul>
          </section>
        ))}
        {courses.length > 0 && (
          <ul className="legend">
            <li><i className="key verified" />Verified: we calculated it and Canvas agrees</li>
            <li><i className="key reported" />Reported by Canvas, not reproduced</li>
            <li><i className="key estimate" />Estimate: nothing to check it against</li>
            <li><i className="key goal" />Your target</li>
          </ul>
        )}
      </main>
    </>
  );
}
