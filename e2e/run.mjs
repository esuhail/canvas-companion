// End-to-end check of milestone 1: loads the built extension in real Chrome and
// proves that extension code can read a cookie-only Canvas, signed out and signed in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
/** Opens every course row so its details can be read and used. */
const openAll = (page) => page.$$eval('.course .head[aria-expanded="false"]', (els) => els.forEach((e) => e.click()));
const text = (page) => page.evaluate(() => document.body.innerText);
const click = async (page, label) => {
  const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === l || (b.firstChild && b.firstChild.textContent.trim() === l)), label);
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
  // Work finished outside Canvas: mark it done, it leaves the list; undo brings it back.
  await click(panel, 'Mark done');
  await panel.waitForFunction(() => document.querySelectorAll('.queue li').length === 0);
  await panel.$eval('.donelist', (d) => { d.open = true; });
  await click(panel, 'Undo');
  await panel.waitForSelector('.queue li');
  console.log('PASS queue ranks open work from live data, and done marks work');
  await click(panel, 'Grades');
  await panel.waitForSelector('.course');
  await openAll(panel);
  await panel.waitForFunction(() => !/Checking the calculation/.test(document.body.innerText));
  const rows = await panel.$$eval('.course', (els) => els.map((e) => e.dataset.basis + ' | ' + e.innerText.replace(/\s+/g, ' ')));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^verified \| CS 310.*C\+.*78\.0%.*Verified: our calculation matches Canvas/);
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
  // What changed: the instructor grades the open exam between two visits.
  canvas.gradeOpenExam(88);
  await panel.reload();
  await panel.waitForSelector('.digest .changes li');
  const changes = await panel.$$eval('.digest .changes li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  assert.deepEqual(changes, ['Item 103 CS 310 Graded: 88 / 100']);
  await click(panel, 'Mark as seen');
  await panel.reload();
  await panel.waitForSelector('.upnext');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await panel.$('.digest'), null, 'digest came back after being marked as seen');
  console.log('PASS a new grade shows up as a change, once');
  await click(panel, 'Grades');
  await panel.waitForSelector('.course .answer');
  await openAll(panel);

  // Syllabus: a real PDF is read in the browser and compared with Canvas (Homework 40%, Exams 60%).
  const upload = await panel.$('#syllabus-1-file');
  await upload.uploadFile(path.resolve('e2e/fixtures/syllabus.pdf'));
  await panel.waitForSelector('.course .syllabus .rows li', { timeout: 10000 }).catch(async () => console.log('SYL', await panel.$eval('.course .syllabus', (e) => e.innerText)));
  const sy = await panel.$$eval('.course:first-child .syllabus .rows li', (els) => els.map((e) => e.className + ' | ' + e.innerText.replace(/\s+/g, ' ')));
  assert.match(sy[0], /^match \| Homework Same in Canvas \(Homework\) 40%/);
  assert.match(sy[1], /^differs \| Exams Canvas says 60% \(Exams\) 50%/);
  assert.match(sy[2], /^not-in-canvas \| Project No matching group in Canvas 10%/);
  assert.match(sy[3], /^not-in-canvas \| Final Exam Not in Canvas Dec 15/);
  // Use the syllabus weights (40 / 50 / 10) for targets: Homework 90%, Exams 79%, Project still to come.
  await click(panel, 'Use these weights for targets');
  await panel.waitForFunction(() => /Using your syllabus weights/.test(document.querySelector('.course .target').innerText));
  assert.match(await panel.$eval('.course .target', (e) => e.innerText), /By those you are at ≈83\.89% now/); // (90*40 + 79*50) / 90
  await click(panel, 'Add to remaining work');
  await panel.waitForFunction(() => /Final Exam.*Exams, added by you/.test(document.querySelector('.course .plan').textContent));
  await (await panel.$('.course')).screenshot({ path: 'e2e/shots/7-syllabus.png' });
  console.log('PASS a PDF syllabus is read, compared with Canvas, and its missing final is added');
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
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await panel.screenshot({ path: 'e2e/shots/6b-upnext-dark.png', fullPage: true });
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await click(panel, 'Grades');
  await panel.waitForSelector('.course');
  await new Promise((r) => setTimeout(r, 300));
  await panel.screenshot({ path: 'e2e/shots/5a-grades-collapsed.png', fullPage: true });
  await panel.$eval('.course .head', (e) => e.click());
  await new Promise((r) => setTimeout(r, 400));
  await panel.$eval('.course .plan', (d) => { d.open = true; });
  await panel.screenshot({ path: 'e2e/shots/5-courses-sample.png', fullPage: true });
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise((r) => setTimeout(r, 500));
  await panel.screenshot({ path: 'e2e/shots/5b-grades-dark.png', fullPage: true });
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // A newer build written to the extension folder is noticed without a manual reload.
  const manifestPath = path.join(EXT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version_name: manifest.version_name + ' next' }));
  await panel.waitForFunction(() => /A newer build is ready/.test(document.body.innerText), { timeout: 30000 });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log('PASS a newer build on disk is detected');

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
