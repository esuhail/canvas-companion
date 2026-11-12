import { useEffect, useState } from 'react';
import type { Course } from '@/lib/core/model';
import { CanvasError, type CanvasFailure } from '@/lib/integration/canvas/client';
import { normalizeOrigin, probe, type ProbeReport } from '@/lib/integration/canvas/probe';
import { CanvasSessionSource } from '@/lib/integration/canvas/source';
import { extensionTransport, tabTransport } from '@/lib/integration/canvas/transport';
import { mockSource } from '@/lib/integration/mock/source';
import type { CourseDataSource } from '@/lib/integration/source';
import { newerBuildOnDisk } from '@/lib/devUpdate';
import { clearConnection, loadConnection, saveConnection, type Connection } from '@/lib/settings';
import { AccessReport } from './AccessReport';
import { Mark } from './Mark';
import { CourseList } from './CourseList';

type View =
  | { name: 'loading' }
  | { name: 'connect'; error?: string }
  | { name: 'checking'; origin: string }
  | { name: 'report'; report: ProbeReport }
  | { name: 'courses'; source: CourseDataSource; courses: Course[]; origin?: string }
  | { name: 'failed'; origin: string; failure: CanvasFailure };

const sourceFor = (c: Connection) =>
  new CanvasSessionSource(c.origin, c.transport === 'tab' ? tabTransport : extensionTransport);

export function App() {
  const [view, setView] = useState<View>({ name: 'loading' });

  async function open(source: CourseDataSource, origin?: string) {
    setView({ name: 'loading' });
    try {
      setView({ name: 'courses', source, courses: await source.listCourses(), origin });
    } catch (e) {
      const failure = e instanceof CanvasError ? e.failure : 'network';
      setView(origin ? { name: 'failed', origin, failure } : { name: 'connect' });
    }
  }

  // Unpacked installs: pick up a newer build without a trip to chrome://extensions.
  const [newBuild, setNewBuild] = useState(false);
  useEffect(() => {
    // On open, switch to the newer build straight away. While open, offer it instead of interrupting.
    void newerBuildOnDisk().then((newer) => { if (newer) chrome.runtime.reload(); });
    const timer = setInterval(() => void newerBuildOnDisk().then(setNewBuild), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadConnection().then((c) => (c ? open(sourceFor(c), c.origin) : setView({ name: 'connect' })));
  }, []);

  async function check(input: string) {
    const origin = normalizeOrigin(input, import.meta.env.DEV || __E2E__);
    if (!origin) {
      setView({ name: 'connect', error: 'Enter the address you use to open Canvas, like canvas.yourschool.edu.' });
      return;
    }
    // Must run inside the click: Chrome only shows the permission prompt on a user action.
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!granted) {
      setView({ name: 'connect', error: 'Chrome needs your permission to read that site. Nothing was changed.' });
      return;
    }
    setView({ name: 'checking', origin });
    setView({ name: 'report', report: await probe(origin) });
  }

  async function useReport(report: ProbeReport) {
    if (!report.usable) return;
    const connection = { origin: report.origin, transport: report.usable };
    await saveConnection(connection);
    await open(sourceFor(connection), report.origin);
  }

  async function disconnect(origin: string) {
    await clearConnection(origin);
    setView({ name: 'connect' });
  }

  if (newBuild) {
    return (
      <main className="sheet">
        <h1>A newer build is ready</h1>
        <p>The extension folder was updated. Switching closes this panel; open it again from the toolbar.</p>
        <div className="actions">
          <button className="primary" onClick={() => chrome.runtime.reload()}>Switch to the new build</button>
          <button onClick={() => setNewBuild(false)}>Not now</button>
        </div>
      </main>
    );
  }
  switch (view.name) {
    case 'loading':
      return <p className="status" role="status">Loading…</p>;
    case 'checking':
      return <p className="status" role="status">Checking access to {new URL(view.origin).host}…</p>;
    case 'connect':
      return <Connect error={view.error} onCheck={check} onSample={() => open(mockSource)} />;
    case 'report':
      return (
        <AccessReport
          report={view.report}
          onUse={() => useReport(view.report)}
          onRetry={() => check(view.report.origin)}
          onBack={() => disconnect(view.report.origin)}
        />
      );
    case 'failed':
      return (
        <main className="sheet">
          <h1>Canvas didn’t answer</h1>
          <p>{explain(view.failure)}</p>
          <div className="actions">
            <button className="primary" onClick={() => check(view.origin)}>Check access again</button>
            <button onClick={() => disconnect(view.origin)}>Disconnect</button>
          </div>
        </main>
      );
    case 'courses':
      return (
        <CourseList
          source={view.source}
          courses={view.courses}
          onRefresh={() => open(view.source, view.origin)}
          onLeave={() => (view.origin ? disconnect(view.origin) : setView({ name: 'connect' }))}
        />
      );
  }
}

export function explain(f: CanvasFailure): string {
  switch (f) {
    case 'signed-out': return 'You’re signed out of Canvas. Sign in to Canvas in a tab, then check again.';
    case 'forbidden': return 'Canvas refused this request for your account. Your school may restrict it.';
    case 'not-canvas': return 'That address didn’t respond like Canvas. Check the address and try again.';
    case 'rate-limited': return 'Canvas asked us to slow down. Wait a minute, then try again.';
    case 'no-tab': return 'Open Canvas in a tab and keep it open, then check again.';
    case 'network': return 'The request didn’t get through. Check your connection and try again.';
  }
}

function Connect(props: { error?: string; onCheck: (v: string) => void; onSample: () => void }) {
  const [value, setValue] = useState('');
  return (
    <main className="sheet welcome">
      <Mark size={36} />
      <h1>Connect your Canvas</h1>
      <p>
        This reads your own courses and grades using the Canvas session already open in this
        browser. It never submits, edits or sends anything, and nothing leaves this computer.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); props.onCheck(value); }}>
        <label htmlFor="origin">Your school’s Canvas address</label>
        <input id="origin" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="canvas.yourschool.edu" autoComplete="off" spellCheck={false}
          aria-describedby={props.error ? 'origin-error' : undefined} />
        {props.error && <p id="origin-error" className="error" role="alert">{props.error}</p>}
        <div className="actions">
          <button className="primary" type="submit">Check access</button>
          <button type="button" onClick={props.onSample}>Look around with sample data</button>
        </div>
      </form>
      <p className="fine">Chrome will ask you to allow this one site. You can disconnect at any time.</p>
    </main>
  );
}
