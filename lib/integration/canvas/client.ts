import { NoCanvasTabError, type RawResponse, type Transport } from './transport';

/** Why a read failed, in terms the UI can explain to a student. */
export type CanvasFailure =
  | 'signed-out' // no valid Canvas session
  | 'forbidden' // session is fine, Canvas refused this read
  | 'not-canvas' // the origin does not look like Canvas
  | 'rate-limited'
  | 'no-tab' // tab transport: no Canvas tab is open
  | 'network';

export class CanvasError extends Error {
  constructor(
    readonly failure: CanvasFailure,
    detail: string,
  ) {
    super(`${failure}: ${detail}`);
  }
}

/**
 * Every path this extension may ever read. A request outside this list throws
 * before it reaches the network, so a bug cannot turn into an unexpected call.
 * Extend deliberately, one endpoint at a time.
 */
const ALLOWED = [
  /^\/api\/v1\/users\/self(\?.*)?$/,
  /^\/api\/v1\/courses(\?.*)?$/,
  /^\/api\/v1\/courses\/\d+\/assignment_groups(\?.*)?$/,
];

export function assertAllowed(pathAndQuery: string): void {
  if (!ALLOWED.some((re) => re.test(pathAndQuery))) {
    throw new Error(`Path is not on the read allowlist: ${pathAndQuery}`);
  }
}

/** Canvas prefixes cookie-authenticated JSON with `while(1);` to block JSON hijacking. */
export function stripPrefix(text: string): string {
  return text.startsWith('while(1);') ? text.slice('while(1);'.length) : text;
}

/** Returns the path+query of rel="next" if it stays on the same origin, else null. */
export function nextPage(link: string | null, origin: string): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (!m?.[1]) continue;
    const url = new URL(m[1], origin);
    return url.origin === origin ? url.pathname + url.search : null;
  }
  return null;
}

export function classify(res: RawResponse, origin: string): CanvasFailure | null {
  if (res.status === 401) return 'signed-out';
  if (res.status === 403) {
    return /rate limit/i.test(res.text) ? 'rate-limited' : 'forbidden';
  }
  if (res.status === 429) return 'rate-limited';
  // Signed-out sessions are often redirected to an SSO page that answers 200 + HTML.
  const movedAway = !res.url.startsWith(origin + '/api/');
  const isJson = res.contentType.includes('json');
  if (movedAway || (res.status === 200 && !isJson)) {
    return /login|sso|saml|cas|shibboleth/i.test(res.url + res.text.slice(0, 2000))
      ? 'signed-out'
      : 'not-canvas';
  }
  if (res.status === 404) return 'not-canvas';
  if (res.status < 200 || res.status >= 300) return 'network';
  return null;
}

const MAX_PAGES = 10;
const GAP_MS = 150; // pause between pages; we are a guest on someone else's server

export class CanvasClient {
  constructor(
    readonly origin: string,
    readonly transport: Transport,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async getOne<T>(pathAndQuery: string): Promise<T> {
    return this.parse<T>(await this.read(pathAndQuery));
  }

  async getAll<T>(pathAndQuery: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = pathAndQuery;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      if (page > 0) await this.wait(GAP_MS);
      const res = await this.read(next);
      out.push(...this.parse<T[]>(res));
      next = nextPage(res.link, this.origin);
    }
    return out;
  }

  private async read(pathAndQuery: string): Promise<RawResponse> {
    assertAllowed(pathAndQuery);
    let res: RawResponse;
    try {
      res = await this.transport.get(this.origin, pathAndQuery);
    } catch (e) {
      const noTab = e instanceof NoCanvasTabError;
      throw new CanvasError(noTab ? 'no-tab' : 'network', String(e));
    }
    const failure = classify(res, this.origin);
    if (failure) throw new CanvasError(failure, `HTTP ${res.status} from ${pathAndQuery}`);
    return res;
  }

  private parse<T>(res: RawResponse): T {
    try {
      return JSON.parse(stripPrefix(res.text)) as T;
    } catch {
      throw new CanvasError('not-canvas', 'Response was not JSON');
    }
  }
}
