import assert from 'node:assert/strict';
import { chromium, webkit, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = resolve(root, '.' + url.pathname.slice('/atlas'.length), url.pathname.endsWith('/') ? 'index.html' : '');
  try {
    if (!url.pathname.startsWith('/atlas/') || !path.startsWith(root + sep)) throw Error();
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(engine === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
    try {
      for (const forceList of [false, true]) {
        const page = await browser.newPage({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', r => { if (r.url().includes('/atlas/') && !r.ok()) errors.push(r.url()); });
        await page.route('https://fonts.**', route => route.abort());
        if (forceList) await page.addInitScript(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            return type.includes('webgl') ? null : getContext.call(this, type, ...args);
          };
        });
        await page.goto('http://127.0.0.1:' + server.address().port + '/atlas/');

        if (forceList) {
          await page.locator('.atlas-list-card').first().tap();
        } else {
          const domain = page.locator('[data-node-id="dom:Intelligence"]');
          await domain.waitFor();
          const canvas = page.locator('#universe-canvas');
          const centerLit = await canvas.evaluate(el => new Promise(done => requestAnimationFrame(() => {
            const gl = el.getContext('webgl2');
            const rgba = new Uint8Array(4);
            gl.readPixels(el.width >> 1, el.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            done(rgba[0] > 70);
          })));
          assert.ok(centerLit, 'ATLAS core should be visible at screen center');
          const projection = () => Array.from(document.querySelectorAll('.tier-domain')).map(el => [el.style.display, el.style.transform]).flat().join('|');
          const position = () => page.evaluate(projection);
          const before = await position();
          await page.locator('#ctrl-zoom-in').tap();
          await page.waitForFunction(old => Array.from(document.querySelectorAll('.tier-domain')).map(el => [el.style.display, el.style.transform]).flat().join('|') !== old, before);
          await page.locator('#ctrl-zoom-out').tap();
          await page.locator('#ctrl-reset').tap();
          const canvasBox = await canvas.boundingBox();
          const x = canvasBox.x + canvasBox.width * 0.48;
          const y = canvasBox.y + canvasBox.height * 0.68;
          const orbitStart = await position();
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + 45, y - 15, { steps: 5 });
          await page.mouse.up();
          await page.waitForFunction(old => Array.from(document.querySelectorAll('.tier-domain')).map(el => [el.style.display, el.style.transform]).flat().join('|') !== old, orbitStart);
          // Start the hierarchy test in its initial viewing direction.
          await page.reload();
          await page.locator('#ctrl-toggle-hud').tap();
          assert.equal(await page.locator('.atlas-topbar').count(), 0);
          assert.equal(await page.locator('.atlas-controls-dock').count(), 0);
          assert.equal(await page.locator('.atlas-subbar').count(), 0);
          await page.locator('.atlas-restore-hud').tap();
          await page.locator('.atlas-topbar').waitFor();
          await domain.tap();
          await page.locator('.tier-category:visible').first().tap();
          const star = page.locator('.tier-repository:visible').first();
          await star.waitFor();
          // Labels sit ten CSS pixels below their projected star centers.
          const box = await star.boundingBox();
          const starName = await star.textContent();
          const point = {x: box.x + box.width / 2, y: box.y - 10};
          const target = await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,point);
          assert.equal(target,'universe-canvas', 'Projected star must be reachable at ' + JSON.stringify(point));
          await page.touchscreen.tap(point.x,point.y);
          await page.locator('.atlas-inspector h2').waitFor();
          assert.equal(await page.locator('.atlas-inspector h2').textContent(), starName);
        }
        await page.locator('.atlas-inspector h2').waitFor();
        await page.locator('#btn-close-inspector').tap();
        await page.locator('#btn-toggle-lang').tap();
        assert.equal(await page.locator('html').getAttribute('lang'), 'en');
        await page.locator('#atlas-search-input').fill('Agentgateway');
        await page.locator('[data-hit-id]').first().tap();
        assert.match(await page.locator('.atlas-inspector h2').innerText(), /agentgateway/i);
        assert.deepEqual(errors, []);
        console.log(engine.name(), forceList ? 'accessible directory' : '3D star selection', 'passed');
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
