import { CanvasClient, CanvasError, type CanvasFailure } from './client';
import type { CanvasCourse } from './mappers';
import { COURSES_PATH } from './source';
import { extensionTransport, tabTransport, type Transport } from './transport';

/**
 * The access check. For each transport it answers three questions with real
 * requests, and keeps nothing but the answers:
 *   1. Does Canvas accept our session?          (users/self)
 *   2. Can we list the student's courses?       (courses)
 *   3. Does Canvas include its computed totals? (fields on the course list)
 */
export interface TransportReport {
  transport: Transport['id'];
  session: 'ok' | CanvasFailure;
  courses: number | CanvasFailure;
  /** Student courses where Canvas sent a computed total / hides it / sent neither. */
  totals: { reported: number; hidden: number; absent: number } | null;
}

export interface ProbeReport {
  origin: string;
  reports: TransportReport[];
  /** First transport that passed checks 1 and 2, or null. */
  usable: Transport['id'] | null;
}

const failureOf = (e: unknown): CanvasFailure =>
  e instanceof CanvasError ? e.failure : 'network';

export async function probeTransport(origin: string, transport: Transport): Promise<TransportReport> {
  const client = new CanvasClient(origin, transport);
  const report: TransportReport = { transport: transport.id, session: 'ok', courses: 0, totals: null };
  try {
    await client.getOne<unknown>('/api/v1/users/self');
  } catch (e) {
    report.session = failureOf(e);
    report.courses = report.session;
    return report;
  }
  try {
    const all = await client.getAll<CanvasCourse>(COURSES_PATH);
    const mine = all.filter((c) => c.enrollments?.some((e) => e.type === 'student'));
    report.courses = mine.length;
    const totals = { reported: 0, hidden: 0, absent: 0 };
    for (const c of mine) {
      const s = c.enrollments?.find((e) => e.type === 'student');
      if (c.hide_final_grades) totals.hidden++;
      else if (typeof s?.computed_current_score === 'number') totals.reported++;
      else totals.absent++;
    }
    report.totals = totals;
  } catch (e) {
    report.courses = failureOf(e);
  }
  return report;
}

export async function probe(
  origin: string,
  transports: Transport[] = [extensionTransport, tabTransport],
): Promise<ProbeReport> {
  const reports: TransportReport[] = [];
  for (const t of transports) reports.push(await probeTransport(origin, t));
  const usable = reports.find((r) => r.session === 'ok' && typeof r.courses === 'number');
  return { origin, reports, usable: usable?.transport ?? null };
}

/** "canvas.gmu.edu", "https://canvas.gmu.edu/courses/1" -> "https://canvas.gmu.edu" */
export function normalizeOrigin(input: string, allowHttpLocalhost = false): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const localhost = url.hostname === 'localhost';
    if (url.protocol === 'http:' && !(localhost && allowHttpLocalhost)) return null;
    if (!url.hostname.includes('.') && !localhost) return null;
    return url.origin;
  } catch {
    return null;
  }
}
