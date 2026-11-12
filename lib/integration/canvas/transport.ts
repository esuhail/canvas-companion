/**
 * A Transport performs one read against a Canvas origin and returns the raw
 * result. Two exist because we do not yet know which one a given school allows:
 *
 *  - extension: fetch from the extension's own pages. Needs host permission for
 *    the origin; Chrome then attaches the student's Canvas session cookies.
 *  - tab: run fetch inside an open Canvas tab, so the request is same-origin,
 *    exactly like a request made by Canvas's own page.
 *
 * Both are GET-only by construction: there is no parameter for a method or body.
 */
export interface RawResponse {
  status: number;
  contentType: string;
  link: string | null;
  text: string;
  /** Final URL after redirects. A redirect to a login page means signed out. */
  url: string;
}

export interface Transport {
  readonly id: 'extension' | 'tab';
  get(origin: string, pathAndQuery: string): Promise<RawResponse>;
}

export const extensionTransport: Transport = {
  id: 'extension',
  async get(origin, pathAndQuery) {
    const res = await fetch(origin + pathAndQuery, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      link: res.headers.get('link'),
      text: await res.text(),
      url: res.url,
    };
  },
};

export class NoCanvasTabError extends Error {
  constructor(origin: string) {
    super(`No open tab on ${origin}`);
  }
}

export const tabTransport: Transport = {
  id: 'tab',
  async get(origin, pathAndQuery) {
    const tabs = await chrome.tabs.query({ url: origin + '/*' });
    const tab = tabs.find((t) => t.id !== undefined);
    if (!tab?.id) throw new NoCanvasTabError(origin);
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [pathAndQuery],
      // Runs in the Canvas tab. Must be self-contained: no outer variables.
      func: async (path: string) => {
        const res = await fetch(path, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        return {
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          link: res.headers.get('link'),
          text: await res.text(),
          url: res.url,
        };
      },
    });
    if (!injected?.result) throw new Error('The Canvas tab did not answer');
    return injected.result as RawResponse;
  },
};
