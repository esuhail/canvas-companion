import type { Course } from '@/lib/core/model';
import type { CourseDataSource } from '@/lib/integration/source';

/** The track spans 50–100%. Most course grades live there; lower values pin to the left edge. */
const LO = 50;
const TICKS = [60, 70, 80, 90];
const pos = (percent: number) => Math.min(100, Math.max(0, ((percent - LO) / (100 - LO)) * 100));
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function Track({ course }: { course: Course }) {
  const o = course.official;
  return (
    <div className={`track ${o.kind}`} aria-hidden="true">
      {TICKS.map((t) => <i key={t} className="tick" style={{ left: `${pos(t)}%` }} />)}
      {o.kind === 'reported' && (
        <>
          <b className="fill" style={{ width: `${pos(o.percent)}%` }} />
          <b className="pin" style={{ left: `${pos(o.percent)}%` }} />
        </>
      )}
    </div>
  );
}

function CourseRow({ course }: { course: Course }) {
  const o = course.official;
  return (
    <li className="course">
      <div className="who">
        <span className="code">{course.code}</span>
        {course.name !== course.code && <span className="name">{course.name}</span>}
      </div>
      <div className="total">
        {o.kind === 'reported'
          ? <><span className="num">{fmt(o.percent)}<small>%</small></span>{o.letter && <span className="letter">{o.letter}</span>}</>
          : <span className="num none">–</span>}
      </div>
      <Track course={course} />
      <p className="basis">
        {o.kind === 'reported' && 'Reported by Canvas'}
        {o.kind === 'hidden' && 'Your instructor hides the total in Canvas'}
        {o.kind === 'none' && 'Nothing graded yet'}
      </p>
    </li>
  );
}

export function CourseList(props: { source: CourseDataSource; courses: Course[]; onRefresh: () => void; onLeave: () => void }) {
  const { source, courses } = props;
  const terms = [...new Set(courses.map((c) => c.term ?? ''))];
  return (
    <>
      <header className="bar">
        <span className={source.live ? 'chip live' : 'chip'}>{source.label}</span>
        <span className="spacer" />
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
              {courses.filter((c) => (c.term ?? '') === term).map((c) => <CourseRow key={c.id} course={c} />)}
            </ul>
          </section>
        ))}
        {courses.length > 0 && (
          <div className="scale" aria-hidden="true">
            <span style={{ left: '0%' }}>50</span>
            {TICKS.map((t) => <span key={t} style={{ left: `${pos(t)}%` }}>{t}</span>)}
            <span style={{ left: '100%' }}>100</span>
          </div>
        )}
      </main>
    </>
  );
}
