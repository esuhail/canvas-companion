# Canvas companion (working title)

A Chrome side panel that shows your own Canvas courses and grades. Read-only. No server, no account, no token. Nothing leaves your browser.

**Status: milestone 3 of several.** Access is proven on GMU Canvas (both transports). The grade engine handles points-based and weighted courses and checks every result against Canvas's own total. The target-score solver answers "what average do I need on what's left" per course and lists its assumptions. Drop rules and the work queue are not built yet.

Every course total is shown in one of four states: **verified** (we calculated it and Canvas agrees), **reported** (Canvas's number, which we could not reproduce), **estimate** (calculated, nothing to check it against), or no number at all.

**Not for public distribution yet.** See [docs/POLICY.md](docs/POLICY.md).

## Run it

```
npm install
npm run build
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick `.output/chrome-mv3`.
2. Sign in to Canvas in a tab and leave it open.
3. Click the extension's toolbar icon. Enter your Canvas address. Click **Check access**.
4. Chrome asks to allow that one site. Allow it.
5. Read the access report. **Copy report** puts a counts-only summary on the clipboard.

`npm run dev` rebuilds on save. **Look around with sample data** works without Canvas.

## Check it

| Command | What it proves |
| --- | --- |
| `npm test` | Grade engine rules, paging, the `while(1);` prefix, the read allowlist, failure classification, mapping |
| `npm run typecheck` | Types |
| `npm run e2e` | Loads the built extension in Chrome against a fake Canvas that rejects tokens and answers only to a session cookie. Checks signed-out, signed-in, both transports, and that only GET requests to two paths were sent. |

## How it is put together

```
lib/core/            Domain model and grade engine. Knows nothing about Canvas, Chrome or React.
lib/integration/     Where data comes from. The UI sees only CourseDataSource.
  canvas/transport   Two ways to make one GET: from the extension, or inside a Canvas tab.
  canvas/client      Allowlist, paging, prefix stripping, failure classification.
  canvas/mappers     Canvas JSON -> domain model. Missing fields degrade to "unknown".
  canvas/probe       The access check.
  mock/              Sample data covering every UI state.
entrypoints/         The extension itself: background worker and side panel (React).
```

To change how we reach Canvas, add a `Transport` or a new `CourseDataSource`. Nothing in `lib/core` or the UI changes.

## What it does not do

- No write requests. Transports have no way to send a method or a body.
- No reads outside the allowlist in `lib/integration/canvas/client.ts`.
- No background activity. Requests happen only while the panel is open.
- No stored course data. Only the Canvas address and the working transport are saved.
