import type { Course, Gradebook } from '@/lib/core/model';
import { buildQueue, dueLabel, WINDOW_DAYS } from '@/lib/core/queue';

const share = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** One ranked list across every course, with the two inputs to the ranking on each row. */
export function UpNext({ entries, loading }: { entries: Array<{ course: Course; book: Gradebook }>; loading: boolean }) {
  const q = buildQueue(entries, new Date());
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
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="fine note">
        Ranked by how much each item is worth and how soon it is due.
        {q.later > 0 && ` ${q.later} more due after ${WINDOW_DAYS} days.`}
        {q.awaiting > 0 && ` ${q.awaiting} past item${q.awaiting === 1 ? ' is' : 's are'} waiting on a grade.`}
        {q.closed > 0 && ` ${q.closed} closed without a submission; targets count ${q.closed === 1 ? 'it' : 'them'} as zero.`}
        {q.undated > 0 && ` ${q.undated} open item${q.undated === 1 ? ' has' : 's have'} no due date and ${q.undated === 1 ? 'is' : 'are'} not listed.`}
      </p>
    </section>
  );
}
