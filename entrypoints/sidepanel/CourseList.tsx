import { useEffect, useState } from 'react';
import { grade } from '@/lib/core/engine';
import type { Course, Gradebook, GradeReport, GroupLine } from '@/lib/core/model';
import { EMPTY_SCENARIO, openItems, plan, type OpenItem, type Scenario } from '@/lib/core/scenario';
import { DEFAULT_TARGET, loadScenarios, loadTargets, saveScenario, saveTarget } from '@/lib/settings';
import type { CourseDataSource } from '@/lib/integration/source';
import { buildQueue } from '@/lib/core/queue';
import { UpNext } from './UpNext';

/** The track spans 50–100%. Most course grades live there; lower values pin to the left edge. */
const LO = 50;
const TICKS = [60, 70, 80, 90];
const pos = (percent: number) => Math.min(100, Math.max(0, ((percent - LO) / (100 - LO)) * 100));
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, '');
const pts = (n: number) => String(Math.round(n * 100) / 100);

type Loaded = (GradeReport & { book: Gradebook }) | 'loading' | 'failed';

/** Plain text for a bug report: outcomes and numbers, no course or assignment names. */
export function resultsText(courses: Course[], reports: Record<string, Loaded>, targetOf: (c: Course) => number, scenarioOf: (c: Course) => Scenario): string {
  const loaded = courses.flatMap((c) => { const r = reports[c.id]; return r && r !== 'loading' && r !== 'failed' ? [{ course: c, book: r.book }] : []; });
  const q = buildQueue(loaded, new Date());
  const queueLine = `queue: ${q.items.length} listed (${q.items.filter((i) => i.overdue).length} overdue, ${q.items.filter((i) => i.impact === null).length} weight unknown), ${q.later} later, ${q.undated} undated, ${q.awaiting} awaiting grade, ${q.closed} closed`;
  return queueLine + '\n' + courses.map((c, i) => {
    const r = reports[c.id];
    const head = `course ${i + 1} (${c.weighted ? 'weighted' : 'points'}, canvas total ${c.official.kind})`;
    if (!r || r === 'loading' || r === 'failed') return `${head}: ${r ?? 'loading'}`;
    const res = r.result;
    const weights = r.groups.reduce((sum, g) => sum + (g.weight ?? 0), 0);
    const detail =
      res.kind === 'mismatch' ? ` computed=${res.computed} reported=${res.reported}`
      : res.kind === 'insufficient' ? ` (${res.missing.join('; ')})`
      : '';
    const sc = scenarioOf(c);
    const p = plan(r.book, res, targetOf(c), sc);
    const solver = p.kind === 'unknown' ? `unknown (${p.missing.join('; ')})`
      : p.kind === 'final' ? `final=${p.percent} reaches=${p.reaches}`
      : `${p.kind}${p.kind === 'needed' ? ` avg=${p.average}` : p.kind === 'secured' ? ` floor=${p.floor}` : ` ceiling=${p.ceiling}`}` +
        ` remaining=${p.details.remainingCount} items/${p.details.remainingPoints} pts emptyGroups=${p.details.emptyGroups.length}` +
        ` whatIfs=${Object.keys(sc.whatIf).length} planned=${sc.planned.length}`;
    const dropped = r.groups.reduce((sum, g) => sum + g.droppedCount, 0);
    return `${head}: ${res.kind}${detail} groups=${r.groups.length} weightSum=${weights} dropped=${dropped}\n  target ${targetOf(c)}: ${solver}`;
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
                <span className="count">{g.gradedCount} of {g.totalCount} graded{g.droppedCount > 0 && `, ${g.droppedCount} dropped`}</span>
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

function Target(props: {
  course: Course; r: GradeReport & { book: Gradebook }; target: number; onTarget: (t: number) => void;
  scenario: Scenario; onScenario: (s: Scenario) => void;
}) {
  const { r, target, scenario } = props;
  const [draft, setDraft] = useState(String(target));
  useEffect(() => setDraft(String(target)), [target]);
  const p = plan(r.book, r.result, target, scenario);
  const open = openItems(r.book, scenario.planned);
  const unfilled = open.filter((i) => scenario.whatIf[i.id] === undefined);
  const id = `target-${props.course.id}`;
  const commit = (raw: string) => {
    const t = Number(raw);
    if (Number.isFinite(t) && t > 0 && t <= 150) props.onTarget(Math.round(t * 10) / 10);
    else setDraft(String(target));
  };
  const details = p.kind === 'unknown' || p.kind === 'final' ? null : p.details;
  // When exactly one real item is left, answer in points on that item.
  const only = details && unfilled.length === 1 && details.emptyGroups.length === 0 ? unfilled[0] : undefined;
  const rest = !details ? '' :
    `the ${details.remainingCount === 0 ? 'work still to come' : `${details.remainingCount} ungraded item${details.remainingCount === 1 ? '' : 's'}`}` +
    (details.remainingPoints > 0 ? ` (${pts(details.remainingPoints)} points)` : '');
  const assumptions = p.kind === 'unknown' ? [] : p.kind === 'final' ? p.assumptions : p.details.assumptions;
  return (
    <section className={`target ${p.kind}${p.kind === 'final' && !p.reaches ? ' short' : ''}`} aria-label={`Target for ${props.course.code}`}>
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
      {p.kind === 'needed' && only && (
        <p className="answer">You need <strong>{pts(Math.ceil(p.average * only.pointsPossible / 10) / 10)} / {pts(only.pointsPossible)}</strong> ({fmt(p.average)}%) on {only.name}.</p>
      )}
      {p.kind === 'needed' && !only && <p className="answer">You need an average of <strong>{fmt(p.average)}%</strong> on {rest}.</p>}
      {p.kind === 'secured' && <p className="answer">Already secured. Even 0% on {rest} leaves you at <strong>{fmt(p.floor)}%</strong>.</p>}
      {p.kind === 'out-of-reach' && <p className="answer">Out of reach with what is listed. 100% on {rest} gets you to <strong>{fmt(p.ceiling)}%</strong>.</p>}
      {p.kind === 'final' && <p className="answer">With those scores you would finish at <strong>{fmt(p.percent)}%</strong>, {p.reaches ? 'which reaches your target' : 'short of your target'}.</p>}
      {p.kind === 'unknown' && <p className="answer">{p.missing.join('. ')}.</p>}
      {r.result.kind !== 'mismatch' && (
        <Remaining course={props.course} book={r.book} open={open} scenario={scenario} onScenario={props.onScenario} />
      )}
      {assumptions.length > 0 && (
        <details className="assume">
          <summary>This projection assumes {assumptions.length} thing{assumptions.length === 1 ? '' : 's'}</summary>
          <ul>{assumptions.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** The open items, each with an optional what-if score, plus a form for work not in Canvas yet. */
function Remaining(props: { course: Course; book: Gradebook; open: OpenItem[]; scenario: Scenario; onScenario: (s: Scenario) => void }) {
  const { course, book, open, scenario } = props;
  const [name, setName] = useState('');
  const [points, setPoints] = useState('100');
  const [groupId, setGroupId] = useState(book.groups[0]?.id ?? '');
  const setWhatIf = (itemId: string, raw: string) => {
    const whatIf = { ...scenario.whatIf };
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n < 0) delete whatIf[itemId];
    else whatIf[itemId] = n;
    props.onScenario({ ...scenario, whatIf });
  };
  const add = () => {
    const p = Number(points);
    if (!name.trim() || !Number.isFinite(p) || p <= 0 || !groupId) return;
    const item = { id: `planned-${Date.now()}`, groupId, name: name.trim(), pointsPossible: p };
    props.onScenario({ ...scenario, planned: [...scenario.planned, item] });
    setName('');
  };
  const remove = (itemId: string) => {
    const whatIf = { ...scenario.whatIf };
    delete whatIf[itemId];
    props.onScenario({ whatIf, planned: scenario.planned.filter((p) => p.id !== itemId) });
  };
  const hasInput = Object.keys(scenario.whatIf).length > 0 || scenario.planned.length > 0;
  return (
    <details className="plan">
      <summary>Remaining work and what-ifs{open.length > 0 ? ` (${open.length})` : ''}</summary>
      {open.length === 0 && <p className="fine">Canvas lists nothing ungraded. Add work your instructor hasn’t posted yet.</p>}
      {open.length > 0 && (
        <ul className="open">
          {open.map((i) => {
            const fid = `whatif-${course.id}-${i.id}`;
            return (
              <li key={i.id}>
                <label htmlFor={fid}>
                  {i.name}
                  <span className="count">{i.groupName}{i.planned ? ', added by you' : ''}</span>
                </label>
                <span className="score">
                  <input id={fid} inputMode="decimal" placeholder="–" defaultValue={scenario.whatIf[i.id] ?? ''}
                    key={`${fid}-${scenario.whatIf[i.id] ?? ''}`}
                    onBlur={(e) => setWhatIf(i.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setWhatIf(i.id, e.currentTarget.value); }}
                    aria-label={`What-if score for ${i.name}, out of ${pts(i.pointsPossible)}`} />
                  <span>/ {pts(i.pointsPossible)}</span>
                  {i.planned && <button type="button" className="quiet" onClick={() => remove(i.id)} aria-label={`Remove ${i.name}`}>Remove</button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <form className="add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <p className="fine">Not in Canvas yet? Add it.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Final exam" aria-label="Name of the work to add" />
        <input className="pts" inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} aria-label="Points possible" />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Assignment group">
          {book.groups.map((g) => <option key={g.id} value={g.id}>{g.name}{book.weighted ? ` (${pts(g.weight)}%)` : ''}</option>)}
        </select>
        <button type="submit">Add</button>
      </form>
      {hasInput && <button type="button" className="quiet clear" onClick={() => props.onScenario(EMPTY_SCENARIO)}>Clear what-ifs and added work</button>}
    </details>
  );
}

function CourseRow({ course, r, target, onTarget, scenario, onScenario }: {
  course: Course; r: Loaded; target: number; onTarget: (t: number) => void; scenario: Scenario; onScenario: (s: Scenario) => void;
}) {
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
      {r !== 'loading' && r !== 'failed' && <Target course={course} r={r} target={target} onTarget={onTarget} scenario={scenario} onScenario={onScenario} />}
      {r !== 'loading' && r !== 'failed' && r.groups.some((g) => g.totalCount > 0) && <Breakdown groups={r.groups} />}
    </li>
  );
}

export function CourseList(props: { source: CourseDataSource; courses: Course[]; onRefresh: () => void; onLeave: () => void }) {
  const { source, courses } = props;
  const [reports, setReports] = useState<Record<string, Loaded>>({});
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'next' | 'grades'>('next');
  const [targets, setTargets] = useState<Record<string, number>>({});
  const key = (c: Course) => `${source.label}:${c.id}`;
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  useEffect(() => { loadTargets().then(setTargets); loadScenarios().then(setScenarios); }, []);
  const setScenario = (c: Course, sc: Scenario) => {
    setScenarios((prev) => ({ ...prev, [key(c)]: sc }));
    void saveScenario(key(c), sc);
  };
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
            onClick={async () => { await navigator.clipboard.writeText(resultsText(courses, reports, (c) => targets[key(c)] ?? DEFAULT_TARGET, (c) => scenarios[key(c)] ?? EMPTY_SCENARIO)); setCopied(true); }}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
        )}
        {source.live && <button className="quiet" onClick={props.onRefresh}>Refresh</button>}
        <button className="quiet" onClick={props.onLeave}>{source.live ? 'Disconnect' : 'Connect Canvas'}</button>
      </header>
      <nav className="tabs" aria-label="Views">
        <button type="button" aria-pressed={tab === 'next'} onClick={() => setTab('next')}>Up next</button>
        <button type="button" aria-pressed={tab === 'grades'} onClick={() => setTab('grades')}>Grades</button>
      </nav>
      {tab === 'next' && courses.length > 0 && (
        <main>
          <UpNext
            loading={courses.some((c) => (reports[c.id] ?? 'loading') === 'loading')}
            entries={courses.flatMap((c) => { const r = reports[c.id]; return r && r !== 'loading' && r !== 'failed' ? [{ course: c, book: r.book }] : []; })} />
        </main>
      )}
      <main hidden={tab === 'next' && courses.length > 0}>
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
                  target={targets[key(c)] ?? DEFAULT_TARGET} onTarget={(t) => setTarget(c, t)}
                  scenario={scenarios[key(c)] ?? EMPTY_SCENARIO} onScenario={(sc) => setScenario(c, sc)} />
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
