// End-to-end check of milestone 1: loads the built extension in real Chrome and
// proves that extension code can read a cookie-only Canvas, signed out and signed in.
import assert from 'node:assert/strict';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startFakeCanvas } from './fake-canvas.mjs';

const EXT = path.resolve('.output/chrome-mv3');
const canvas = await startFakeCanvas();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  ignoreDefaultArgs: ['--disable-extensions'],
});
const text = (page) => page.evaluate(() => document.body.innerText);
const click = async (page, label) => {
  const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === l), label);
  assert(handle.asElement(), `button "${label}" not found`);
  await handle.asElement().click();
};
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
  const panelUrl = `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`;
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 760, deviceScaleFactor: 2 });
  await panel.goto(panelUrl);
  await panel.waitForSelector('#origin');
  await panel.screenshot({ path: 'e2e/shots/1-connect.png' });

  // 1. Signed out: both transports must say so, in words.
  const tab = await browser.newPage();
  await tab.goto(canvas.origin + '/logout');
  await panel.bringToFront();
  await panel.type('#origin', canvas.origin);
  await click(panel, 'Check access');
  await panel.waitForFunction(() => /Access (works|didn’t work)/.test(document.body.innerText));
  let body = await text(panel);
  assert.match(body, /Access didn’t work/);
  assert.match(body, /signed out of Canvas/);
  await panel.screenshot({ path: 'e2e/shots/2-signed-out.png' });
  console.log('PASS signed out is detected');

  // 2. Signed in: the extension itself (not just a tab) reads the API.
  await tab.goto(canvas.origin + '/login');
  await panel.bringToFront();
  await click(panel, 'Check access again');
  await panel.waitForFunction(() => /Access works/.test(document.body.innerText));
  await click(panel, 'Copy report').catch(() => {});
  body = await text(panel);
  const sections = await panel.$$eval('.transport', (els) => els.map((e) => e.innerText));
  assert.equal(sections.length, 2);
  for (const s of sections) {
    assert.match(s, /Canvas accepted your session/);
    assert.match(s, /Found 3 courses you take/);
    assert.match(s, /shares its total in 2 of 3, hides it in 1/);
  }
  await panel.screenshot({ path: 'e2e/shots/3-access-works.png' });
  console.log('PASS extension-origin fetch and in-tab fetch both read the API');

  // 3. Courses render from live data, across two pages, without the TA course.
  await click(panel, 'Show my courses');
  await panel.waitForSelector('.course');
  const rows = await panel.$$eval('.course', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /CS 310.*91\.4.*A-.*Reported by Canvas/);
  assert.match(rows[1], /CS 330.*hides the total/);
  assert.match(rows[2], /MATH 203.*78\.3/);
  await panel.screenshot({ path: 'e2e/shots/4-courses-live.png', fullPage: true });
  console.log('PASS courses render from the session API');

  // 4. The connection survives a reload, and Disconnect forgets it.
  await panel.reload();
  await panel.waitForSelector('.course');
  await click(panel, 'Disconnect');
  await panel.waitForSelector('#origin');
  await panel.reload();
  await panel.waitForSelector('#origin');
  console.log('PASS connection persists and disconnect clears it');

  // 5. Sample data.
  await click(panel, 'Look around with sample data');
  await panel.waitForSelector('.course');
  await panel.screenshot({ path: 'e2e/shots/5-courses-sample.png', fullPage: true });

  // 6. What reached the server: GET only, no Authorization header, allowlisted API paths only.
  const api = canvas.log.filter((r) => r.path.startsWith('/api/'));
  assert(api.length > 0);
  assert(api.every((r) => r.method === 'GET'), 'a non-GET request was sent');
  assert(api.every((r) => !r.auth), 'an Authorization header was sent');
  assert.deepEqual([...new Set(api.map((r) => r.path))].sort(), ['/api/v1/courses', '/api/v1/users/self']);
  console.log(`PASS ${api.length} API requests: all GET, no tokens, 2 distinct paths`);
} finally {
  await browser.close();
  canvas.close();
}
