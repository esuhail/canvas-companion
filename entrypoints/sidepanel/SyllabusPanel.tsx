import { useEffect, useState } from 'react';
import type { Course, Gradebook } from '@/lib/core/model';
import type { Scenario } from '@/lib/core/scenario';
import { compareItems, compareWeights, likelyGroup, mergeSyllabus, readSyllabus, type ItemRow, type Syllabus, type WeightRow } from '@/lib/core/syllabus';
import { onDeviceModelReady, readWithModel } from '@/lib/integration/ai/onDevice';
import { fileText } from '@/lib/integration/files/text';

const n = (x: number) => String(Math.round(x * 100) / 100);
const day = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no date';

function weightNote(r: WeightRow): string {
  switch (r.status) {
    case 'match': return `Same in Canvas (${r.canvasName})`;
    case 'differs': return `Canvas says ${n(r.canvas)}% (${r.canvasName})`;
    case 'canvas-unweighted': return `Canvas has “${r.canvasName}” but gives it no weight`;
    case 'not-in-canvas': return 'No matching group in Canvas';
    case 'not-in-syllabus': return 'In Canvas, not found in the syllabus';
  }
}

function itemNote(r: ItemRow): string {
  switch (r.status) {
    case 'match': return `In Canvas as “${r.canvasName}”`;
    case 'date-differs': return `Canvas has “${r.canvasName}” due ${day(r.canvasDate)}`;
    case 'not-in-canvas': return 'Not in Canvas';
  }
}

/** Upload or paste a syllabus, review what was read, and see how it differs from Canvas. */
export function SyllabusPanel(props: {
  course: Course; book: Gradebook; saved: Syllabus | null; onSave: (s: Syllabus | null) => void;
  scenario: Scenario; onScenario: (s: Scenario) => void;
}) {
  const { course, book, saved, scenario } = props;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [modelReady, setModelReady] = useState(false);
  const [useModel, setUseModel] = useState(false);
  useEffect(() => { void onDeviceModelReady().then(setModelReady); }, []);

  async function read(source: string) {
    if (!source.trim()) { setNote('Paste the syllabus text or choose a file first.'); return; }
    setBusy(true);
    setNote('');
    let result = readSyllabus(source, new Date());
    if (useModel) {
      const extra = await readWithModel(source, new Date());
      if (extra) result = mergeSyllabus(result, extra);
    }
    setBusy(false);
    if (result.weights.length === 0 && result.items.length === 0) {
      setNote('Nothing recognisable was found: no grade weights and no dated work. If the file is a scan, paste the text instead.');
      return;
    }
    props.onSave(result);
    setText('');
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await read(await fileText(file));
    } catch {
      setBusy(false);
      setNote('That file couldn’t be read. Try a text-based PDF or paste the text.');
    }
  }

  const addPlanned = (title: string) => {
    const groupId = likelyGroup(title, book);
    if (!groupId) return;
    props.onScenario({ ...scenario, planned: [...scenario.planned, { id: `planned-${Date.now()}`, groupId, name: title, pointsPossible: 100 }] });
  };
  const fid = `syllabus-${course.id}`;

  if (!saved) {
    return (
      <details className="syllabus">
        <summary>Check against your syllabus</summary>
        <p className="fine">Reads grade weights and dated work from your syllabus and shows where Canvas differs. The file stays in this browser.</p>
        <label htmlFor={`${fid}-file`}>Syllabus file (PDF or text)</label>
        <input id={`${fid}-file`} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" disabled={busy}
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <label htmlFor={`${fid}-text`}>Or paste the text</label>
        <textarea id={`${fid}-text`} rows={4} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        {modelReady && (
          <label className="check">
            <input type="checkbox" checked={useModel} onChange={(e) => setUseModel(e.target.checked)} />
            Also ask Chrome’s on-device model (experimental)
          </label>
        )}
        <div className="actions">
          <button type="button" onClick={() => void read(text)} disabled={busy}>{busy ? 'Reading…' : 'Read syllabus'}</button>
        </div>
        {note && <p className="error" role="alert">{note}</p>}
      </details>
    );
  }

  const weightRows = compareWeights(saved.weights, book);
  const itemRows = compareItems(saved.items, book);
  const flagged = weightRows.filter((r) => r.status !== 'match').length + itemRows.filter((r) => r.status !== 'match').length;
  const dropWeight = (name: string) => {
    const weights = saved.weights.filter((w) => w.name !== name);
    props.onSave({ ...saved, weights, weightSum: Math.round(weights.reduce((s, w) => s + w.weight, 0) * 100) / 100 });
  };
  const dropItem = (title: string, date: string) =>
    props.onSave({ ...saved, items: saved.items.filter((i) => !(i.title === title && i.date === date)) });

  return (
    <details className="syllabus" open>
      <summary>Syllabus check{flagged > 0 ? `: ${flagged} difference${flagged === 1 ? '' : 's'}` : ': matches Canvas'}</summary>
      <p className="fine">Read automatically, so it can be wrong. Remove anything that isn’t in your syllabus.</p>

      {saved.weights.length > 0 && (
        <>
          <h3>Grade weights</h3>
          <ul className="rows">
            {weightRows.map((r) => (
              <li key={r.status === 'not-in-syllabus' ? `c-${r.canvasName}` : `s-${r.name}`} className={r.status}>
                <span className="lead">
                  {r.status === 'not-in-syllabus' ? r.canvasName : r.name}
                  <span className="count">{weightNote(r)}</span>
                </span>
                <span className="val">{r.status === 'not-in-syllabus' ? `${n(r.canvas)}%` : `${n(r.syllabus)}%`}</span>
                {r.status !== 'not-in-syllabus' && <button type="button" className="quiet" onClick={() => dropWeight(r.name)} aria-label={`Remove ${r.name}`}>Remove</button>}
              </li>
            ))}
          </ul>
          {Math.abs(saved.weightSum - 100) > 0.5 && <p className="warn">These weights add up to {n(saved.weightSum)}%, not 100%. Something was probably missed.</p>}
        </>
      )}

      {saved.items.length > 0 && (
        <>
          <h3>Dated work</h3>
          <ul className="rows">
            {itemRows.map((r) => {
              const added = scenario.planned.some((p) => p.name === r.title);
              return (
                <li key={`${r.title}-${r.date}`} className={r.status}>
                  <span className="lead">
                    {r.title}
                    <span className="count">{itemNote(r)}</span>
                  </span>
                  <span className="val">{day(r.date)}</span>
                  <span className="acts">
                    {r.status === 'not-in-canvas' && (added
                      ? <span className="count">Added to remaining work</span>
                      : <button type="button" className="quiet" onClick={() => addPlanned(r.title)}>Add to remaining work</button>)}
                    <button type="button" className="quiet" onClick={() => dropItem(r.title, r.date)} aria-label={`Remove ${r.title}`}>Remove</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button type="button" className="quiet clear" onClick={() => props.onSave(null)}>Forget this syllabus</button>
    </details>
  );
}
