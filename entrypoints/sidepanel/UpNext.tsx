import { ago, type Change } from '@/lib/core/digest';
import type { Course, Gradebook } from '@/lib/core/model';
import { buildQueue, doneKey, dueLabel, WINDOW_DAYS } from '@/lib/core/queue';

const share = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

const n = (x: number) => String(Math.round(x * 100) / 100);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no date');

function describe(c: Change): string {
  const of = (v: number, p: number | null) => (p ? `${n(v)} / ${n(p)}` : n(v));
  switch (c.kind) {
    case 'graded': return `Graded: ${of(c.score, c.pointsPossible)}`;
    case 'regraded': return `Grade changed from ${n(c.from)} to ${of(c.to, c.pointsPossible)}`;
    case 'due-moved': return `Due date moved from ${day(c.from)} to ${day(c.to)}`;
    case 'added': return c.dueAt ? `New, due ${day(c.dueAt)}` : 'New';
  }
}

/** What changed since the last visit. Stays until the student says they have seen it. */
export function Digest({ changes, since, onSeen }: { changes: Change[]; since: string; onSeen: () => void }) {
  if (changes.length === 0) return null;
  const shown = changes.slice(0, 12);
  return (
    <section className="term digest" aria-label="Changes since your last visit">
      <h2>Changed since your last visit, {ago(since, new Date())}</h2>
      <ul className="courses changes">
        {shown.map((c, i) => (
          <li key={i} className={c.kind}>
            <span className="what">
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : <span className="title">{c.name}</span>}
              <span className="name">{c.courseCode}</span>
            </span>
            <span className="how">{describe(c)}</span>
          </li>
        ))}
      </ul>
      <div className="seen">
        {changes.length > shown.length && <span className="fine">and {changes.length - shown.length} more</span>}
        <button type="button" onClick={onSeen}>Mark as seen</button>
      </div>
    </section>
  );
}

/** One ranked list across every course, with the two inputs to the ranking on each row. */
export function UpNext({ entries, loading, done, onDone }: {
  entries: Array<{ course: Course; book: Gradebook }>; loading: boolean;
  done: ReadonlySet<string>; onDone: (key: string, isDone: boolean) => void;
}) {
  const q = buildQueue(entries, new Date(), done);
  const biggest = Math.max(1, ...q.items.map((i) => i.impact ?? 0));
  return (
    <section className="term upnext">
      <h2>Up next, across all courses</h2>
      {q.items.length === 0 && (
        <div className="courses empty">
          <p>{loading ? 'Loading your courses…' : `Nothing open is due in the next ${WINDOW_DAYS} days.`}</p>
        </div>
      )}
      {q.items.length > 0 && (
        <ol className="courses queue">
          {q.items.map((i) => (
            <li key={`${i.courseId}-${i.assignmentId}`} className={i.overdue ? 'overdue' : undefined}>
              <div className="what">
                {i.url
                  ? <a href={i.url} target="_blank" rel="noreferrer">{i.name}</a>
                  : <span className="title">{i.name}</span>}
                <span className="name">{i.courseCode}</span>
              </div>
              <div className="when">{dueLabel(i.daysLeft)}</div>
              <div className="worth">
                <span className="meter" aria-hidden="true"><b style={{ width: `${Math.max(3, ((i.impact ?? 0) / biggest) * 100)}%` }} /></span>
                <span>{i.impact === null ? 'Weight unknown' : `Worth ${share(i.impact)}% of your grade`}</span>
                <button type="button" className="quiet mark" onClick={() => onDone(doneKey(i.courseId, i.assignmentId), true)}
                  aria-label={`Mark ${i.name} as done`}>Mark done</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {q.undatedItems.length > 0 && (
        <details className="donelist undated">
          <summary>No due date ({q.undatedItems.length})</summary>
          <ul>
            {q.undatedItems.map((i) => (
              <li key={`${i.courseId}-${i.assignmentId}`}>
                <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.name}</a> : i.name} <span className="name">{i.courseCode}</span></span>
                <span className="side">
                  {i.impact !== null && <span>{share(i.impact)}%</span>}
                  <button type="button" className="quiet" onClick={() => onDone(doneKey(i.courseId, i.assignmentId), true)} aria-label={`Mark ${i.name} as done`}>Done</button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {q.done.length > 0 && (
        <details className="donelist">
          <summary>Marked done by you ({q.done.length})</summary>
          <ul>
            {q.done.map((i) => (
              <li key={`${i.courseId}-${i.assignmentId}`}>
                <span><s>{i.name}</s> <span className="name">{i.courseCode}</span></span>
                <button type="button" className="quiet" onClick={() => onDone(doneKey(i.courseId, i.assignmentId), false)}
                  aria-label={`Put ${i.name} back on the list`}>Undo</button>
              </li>
            ))}
          </ul>
          <p className="fine">Canvas still shows these as ungraded. They drop off this list on their own once graded.</p>
        </details>
      )}
      <p className="fine note">
        Ranked by how much each item is worth and how soon it is due.
        {q.later > 0 && ` ${q.later} more due after ${WINDOW_DAYS} days.`}
        {q.awaiting > 0 && ` ${q.awaiting} past item${q.awaiting === 1 ? ' is' : 's are'} waiting on a grade.`}
        {q.closed > 0 && ` ${q.closed} closed without a submission; targets count ${q.closed === 1 ? 'it' : 'them'} as zero.`}

      </p>
    </section>
  );
}
