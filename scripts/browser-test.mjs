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
          await page.locator('[data-node-id="dom:Intelligence"]').tap();
          await page.locator('.tier-category:visible').first().tap();
          await page.locator('.tier-repository:visible').first().tap();
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
