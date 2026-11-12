import { useState } from 'react';
import type { CanvasFailure } from '@/lib/integration/canvas/client';
import type { ProbeReport, TransportReport } from '@/lib/integration/canvas/probe';
import { explain } from './App';

const NAMES = { extension: 'From the extension', tab: 'From your open Canvas tab' } as const;

/** Plain-text version for pasting into a bug report. Contains counts only, no course names. */
export function reportText(r: ProbeReport): string {
  const lines = [`Access check for ${new URL(r.origin).host}`];
  for (const t of r.reports) {
    lines.push(
      `${t.transport}: session=${t.session}, courses=${t.courses}, totals=` +
        (t.totals ? `${t.totals.reported} reported / ${t.totals.hidden} hidden / ${t.totals.absent} absent` : 'n/a'),
    );
  }
  lines.push(`usable=${r.usable ?? 'none'}`);
  return lines.join('\n');
}

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'check pass' : 'check fail'}>
      <span className="mark" aria-hidden="true">{ok ? '✓' : '×'}</span>
      <span>{children}</span>
    </li>
  );
}

function Transport({ t }: { t: TransportReport }) {
  const sessionOk = t.session === 'ok';
  const coursesOk = typeof t.courses === 'number';
  return (
    <section className="transport">
      <h2>{NAMES[t.transport]}</h2>
      <ul>
        <Row ok={sessionOk}>
          {sessionOk ? 'Canvas accepted your session' : explain(t.session as CanvasFailure)}
        </Row>
        {sessionOk && (
          <Row ok={coursesOk}>
            {coursesOk ? `Found ${t.courses} course${t.courses === 1 ? '' : 's'} you take` : explain(t.courses as CanvasFailure)}
          </Row>
        )}
        {t.totals && (
          <Row ok={t.totals.reported > 0}>
            Canvas shares its total in {t.totals.reported} of {t.courses as number}
            {t.totals.hidden > 0 && `, hides it in ${t.totals.hidden}`}
            {t.totals.absent > 0 && `, has none yet in ${t.totals.absent}`}
          </Row>
        )}
      </ul>
    </section>
  );
}

export function AccessReport(props: { report: ProbeReport; onUse: () => void; onRetry: () => void; onBack: () => void }) {
  const { report } = props;
  const [copied, setCopied] = useState(false);
  return (
    <main className="sheet">
      <h1>{report.usable ? 'Access works' : 'Access didn’t work'}</h1>
      <p>
        {report.usable
          ? `We tried two ways of reading ${new URL(report.origin).host}. At least one works.`
          : `Neither way of reading ${new URL(report.origin).host} worked. The reasons are below.`}
      </p>
      {report.reports.map((t) => <Transport key={t.transport} t={t} />)}
      <div className="actions">
        {report.usable
          ? <button className="primary" onClick={props.onUse}>Show my courses</button>
          : <button className="primary" onClick={props.onRetry}>Check access again</button>}
        <button onClick={async () => { await navigator.clipboard.writeText(reportText(report)); setCopied(true); }}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <button onClick={props.onBack}>Disconnect</button>
      </div>
      <p className="fine">The report holds counts only. No course names or grades.</p>
    </main>
  );
}
