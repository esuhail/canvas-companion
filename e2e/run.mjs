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
  panel.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  panel.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
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
  // The queue is the first view: one open item, due in 3 days, worth 30% (60% group, half its points).
  await panel.waitForSelector('.queue li');
  const queued = await panel.$$eval('.queue li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  assert.equal(queued.length, 1);
  assert.match(queued[0], /Item 103 CS 310 Due in 3 days Worth 30% of your grade/);
  console.log('PASS queue ranks open work from live data');
  await click(panel, 'Grades');
  await panel.waitForSelector('.course');
  await panel.waitForFunction(() => !/Checking the calculation/.test(document.body.innerText));
  const rows = await panel.$$eval('.course', (els) => els.map((e) => e.dataset.basis + ' | ' + e.innerText.replace(/\s+/g, ' ')));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^verified \| CS 310.*78\.0%.*C\+.*Verified: our calculation matches Canvas/);
  assert.match(rows[1], /^estimate \| CS 330.*≈ ?85\.0%.*Estimate.*hides the total/);
  assert.match(rows[2], /^verified \| MATH 203.*95\.0%.*Verified/); // lowest quiz dropped
  // Solver on live data: HW 40% (90/100), Exams 60% (70/100 graded, 100 left).
  const answer = () => panel.$eval('.course .answer', (e) => e.innerText);
  assert.match(await answer(), /Out of reach.*1 ungraded item \(100 points\).*87\.0%/);
  await panel.focus('#target-1');
  await panel.$eval('#target-1', (e) => e.select());
  await panel.type('#target-1', '80');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => /You need/.test(document.querySelector('.course .answer').innerText));
  assert.match(await answer(), /76\.7%/);
  // One item left, so the answer is in points on that item.
  assert.match(await answer(), /You need 76\.7 \/ 100 \(76\.7%\) on Item 103/);
  // What-if: 100 on the remaining exam -> 36 + 60*170/200 = 87.
  await panel.$eval('.course .plan', (d) => { d.open = true; });
  await panel.type('#whatif-1-103', '100');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => /would finish/.test(document.querySelector('.course .answer').innerText));
  assert.match(await answer(), /would finish at 87\.0%, which reaches your target/);
  // Work that is not in Canvas: a 100-point item in Homework, with no what-if on it.
  await panel.type('.course .plan .add input[aria-label="Name of the work to add"]', 'Bonus set');
  await panel.click('.course .plan .add button[type=submit]');
  await panel.waitForFunction(() => /Bonus set/.test(document.querySelector('.course .answer').innerText));
  assert.match(await answer(), /You need .* \/ 100 .* on Bonus set/);
  console.log('PASS solver answers per item, with a what-if score and with added work');
  await panel.screenshot({ path: 'e2e/shots/4-courses-live.png', fullPage: true });
  console.log('PASS verified, estimate and a drop rule all come out of live data');

  // 4. The connection survives a reload, and Disconnect forgets it.
  await panel.reload();
  await panel.waitForSelector('.tabs');
  await click(panel, 'Grades');
  await panel.waitForSelector('.course .answer');
  assert.equal(await panel.$eval('#target-1', (e) => e.value), '80', 'target was not remembered');
  await click(panel, 'Disconnect');
  await panel.waitForSelector('#origin');
  await panel.reload();
  await panel.waitForSelector('#origin');
  console.log('PASS connection persists and disconnect clears it');

  // 5. Sample data.
  await click(panel, 'Look around with sample data');
  await panel.waitForSelector('.queue li');
  await panel.screenshot({ path: 'e2e/shots/6-upnext-sample.png', fullPage: true });
  await click(panel, 'Grades');
  await panel.waitForSelector('.course');
  await panel.screenshot({ path: 'e2e/shots/5-courses-sample.png', fullPage: true });

  // 6. What reached the server: GET only, no Authorization header, allowlisted API paths only.
  const api = canvas.log.filter((r) => r.path.startsWith('/api/'));
  assert(api.length > 0);
  assert(api.every((r) => r.method === 'GET'), 'a non-GET request was sent');
  assert(api.every((r) => !r.auth), 'an Authorization header was sent');
  const kinds = [...new Set(api.map((r) => r.path.replace(/courses\/\d+/, 'courses/:id')))].sort();
  assert.deepEqual(kinds, ['/api/v1/courses', '/api/v1/courses/:id/assignment_groups', '/api/v1/users/self']);
  assert(api.filter((r) => r.path.endsWith('assignment_groups')).every((r) => r.excludesDescription), 'assignment descriptions were requested');
  console.log(`PASS ${api.length} API requests: all GET, no tokens, 3 endpoint kinds, no assignment text requested`);
} finally {
  await browser.close();
  canvas.close();
}
