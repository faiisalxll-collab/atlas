import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = 'https://faiisalxll-collab.github.io/atlas/';
const phase = process.argv[2];
const dir = 'audit/' + phase;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const sizes = [[375,667], [390,844], [430,932], [1440,900]];
  if (phase === 'after') sizes.push([390,844,1000]);
  for (const [width, height, stress] of sizes) {
    const page = await browser.newPage({
      ...(width < 500 ? devices['iPhone 13'] : {}), viewport: {width, height}, reducedMotion: 'reduce'
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error' && /WebGL/i.test(e.text())) errors.push(e.text()); });
    await page.route('https://fonts.**', route => route.abort());
    if (stress) await page.route('**/data/repositories.json', async route => {
      const rows = await (await route.fetch()).json();
      const json = Array.from({length: stress}, (_, i) => ({
        ...rows[i % rows.length], id: 'fixture-' + i, name: 'Fixture ' + i, githubUrl: null
      }));
      await route.fulfill({json});
    });
    assert.equal((await page.goto(url)).status(), 200);
    await page.locator('.tier-domain:visible').first().waitFor();
    const name = width + (stress ? '-stress' : '');
    const measure = async stage => {
      const m = await page.locator('canvas').evaluate(async c => {
        const gl = c.getContext('webgl2');
        const start = performance.now();
        for (let i=0; i<20; i++) await new Promise(requestAnimationFrame);
        return { rect: c.getBoundingClientRect().toJSON(), innerHeight, viewport: visualViewport.height,
          buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], glError: gl.getError(),
          rafPerSecond: Math.round(20000 / (performance.now()-start)), heapMB: Math.round(performance.memory.usedJSHeapSize/1048576) };
      });
      console.log(JSON.stringify({phase, width, height, stress, stage, ...m}));
      assert.equal(m.rect.width,width);
      assert.equal(m.rect.height,height);
      assert.equal(m.glError,0);
      if (phase === 'after') assert.ok(m.buffer[0]*m.buffer[1] <= 2000000);
    };
    await measure('overview');
    await page.screenshot({path: dir + '/' + name + '.png'});
    if (stress) {
      await page.locator('#ctrl-expand-all').click();
      assert.equal(await page.locator('.tier-repository').count(),1000);
      await measure('expanded');
    } else {
      await page.locator('.tier-domain:visible').first().click();
      await page.locator('.tier-category:visible').first().click();
      const star = page.locator('.tier-repository:visible').first();
      await star.waitFor();
      await page.screenshot({path: dir + '/' + name + '-stars.png'});
      const title = await star.innerText();
      await star.click();
      assert.equal(await page.locator('.atlas-inspector h2').innerText(),title);
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
} finally { await browser.close(); }
