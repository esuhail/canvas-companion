import { describe, expect, it } from 'vitest';
import { CanvasClient, CanvasError, assertAllowed, classify, nextPage, stripPrefix } from '../lib/integration/canvas/client';
import type { RawResponse, Transport } from '../lib/integration/canvas/transport';

const O = 'https://canvas.example.edu';
const ok = (body: unknown, extra: Partial<RawResponse> = {}): RawResponse => ({
  status: 200, contentType: 'application/json; charset=utf-8', link: null,
  text: 'while(1);' + JSON.stringify(body), url: O + '/api/v1/courses', ...extra,
});
const fake = (pages: Record<string, RawResponse>, seen: string[] = []): Transport => ({
  id: 'extension',
  get: async (_o, p) => { seen.push(p); const r = pages[p]; if (!r) throw new Error('offline'); return r; },
});

describe('stripPrefix', () => {
  it('removes the while(1); guard and leaves plain JSON alone', () => {
    expect(stripPrefix('while(1);[1]')).toBe('[1]');
    expect(stripPrefix('[1]')).toBe('[1]');
  });
});

describe('nextPage', () => {
  it('follows rel=next on the same origin', () => {
    const link = `<${O}/api/v1/courses?page=2&per_page=50>; rel="next", <${O}/api/v1/courses?page=1>; rel="first"`;
    expect(nextPage(link, O)).toBe('/api/v1/courses?page=2&per_page=50');
  });
  it('refuses a next link that points at another origin', () => {
    expect(nextPage('<https://evil.example/api/v1/courses?page=2>; rel="next"', O)).toBeNull();
  });
  it('returns null when there is no next page', () => {
    expect(nextPage(`<${O}/api/v1/courses?page=1>; rel="last"`, O)).toBeNull();
    expect(nextPage(null, O)).toBeNull();
  });
});

describe('allowlist', () => {
  it('permits only the endpoints we have deliberately added', () => {
    expect(() => assertAllowed('/api/v1/users/self')).not.toThrow();
    expect(() => assertAllowed('/api/v1/courses?per_page=50')).not.toThrow();
    expect(() => assertAllowed('/api/v1/courses/12/assignment_groups?include[]=assignments')).not.toThrow();
    expect(() => assertAllowed('/api/v1/courses/1/quizzes')).toThrow();
    expect(() => assertAllowed('/api/v1/courses/1/assignment_groups/2')).toThrow();
    expect(() => assertAllowed('/api/v1/conversations')).toThrow();
    expect(() => assertAllowed('/login')).toThrow();
  });
});

describe('classify', () => {
  it('reads 401 as signed out', () => {
    expect(classify(ok({}, { status: 401 }), O)).toBe('signed-out');
  });
  it('reads a redirect to an SSO page as signed out', () => {
    const res = ok({}, { url: 'https://sso.example.edu/login', contentType: 'text/html', text: '<html>Login</html>' });
    expect(classify(res, O)).toBe('signed-out');
  });
  it('reads HTML with no login hint as not Canvas', () => {
    const res = ok({}, { url: O + '/api/v1/users/self', contentType: 'text/html', text: '<html>Hello</html>' });
    expect(classify(res, O)).toBe('not-canvas');
  });
  it('tells a rate limit from a refusal', () => {
    expect(classify(ok({}, { status: 403, text: '403 Forbidden (Rate Limit Exceeded)' }), O)).toBe('rate-limited');
    expect(classify(ok({}, { status: 403, text: '{"status":"unauthorized"}' }), O)).toBe('forbidden');
  });
  it('accepts a normal JSON answer', () => {
    expect(classify(ok([]), O)).toBeNull();
  });
});

describe('CanvasClient', () => {
  const first = '/api/v1/courses?per_page=50';
  const second = '/api/v1/courses?page=2&per_page=50';
  it('joins pages in order', async () => {
    const seen: string[] = [];
    const t = fake({
      [first]: ok([{ id: 1 }], { link: `<${O}${second}>; rel="next"` }),
      [second]: ok([{ id: 2 }]),
    }, seen);
    const client = new CanvasClient(O, t, async () => {});
    expect(await client.getAll(first)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(seen).toEqual([first, second]);
  });
  it('never sends a path that is off the allowlist', async () => {
    const seen: string[] = [];
    const client = new CanvasClient(O, fake({}, seen));
    await expect(client.getOne('/api/v1/courses/1/assignments/2/submissions')).rejects.toThrow(/allowlist/);
    expect(seen).toEqual([]);
  });
  it('reports a thrown transport error as a network failure', async () => {
    const client = new CanvasClient(O, fake({}));
    await expect(client.getOne('/api/v1/users/self')).rejects.toMatchObject({ failure: 'network' } satisfies Partial<CanvasError>);
  });
});
