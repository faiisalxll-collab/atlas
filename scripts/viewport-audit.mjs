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
    // Count submitted WebGL primitives inside this test context only.
    await page.addInitScript(() => {
      const counters = window.auditDraws = {calls: 0, triangles: 0};
      const proto = WebGL2RenderingContext.prototype;
      for (const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        const draw = proto[name];
        proto[name] = function(...args) {
          counters.calls++;
          if (args[0] === this.TRIANGLES) {
            const count = args[name.includes('Arrays') ? 2 : 1];
            counters.triangles += count / 3 * (name.endsWith('Instanced') ? args.at(-1) : 1);
          }
          return draw.apply(this,args);
        };
      }
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
        const before = {...window.auditDraws};
        const start = performance.now();
        for (let i=0; i<20; i++) await new Promise(requestAnimationFrame);
        return { rect: c.getBoundingClientRect().toJSON(), innerHeight, viewport: visualViewport.height,
          drawCalls: (window.auditDraws.calls-before.calls)/20, triangles: (window.auditDraws.triangles-before.triangles)/20,
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
    if (width === 390 && !stress && phase === 'after') {
      const client = await page.context().newCDPSession(page);
      const projected = () => page.locator('.tier-domain').evaluateAll(nodes => nodes.map(n=>n.style.transform).join('|'));
      const gesture = async (start, end) => {
        const previous = await projected();
        const send = (type, points) => client.send('Input.dispatchTouchEvent', {
          type, touchPoints: points.map(([x,y],id)=>({x,y,id}))
        });
        await send('touchStart',start);
        for (let i=1;i<=5;i++) await send('touchMove',start.map(([x,y],j)=>[
          x+(end[j][0]-x)*i/5, y+(end[j][1]-y)*i/5
        ]));
        await send('touchEnd',[]);
        await page.waitForFunction(old=>Array.from(document.querySelectorAll('.tier-domain')).map(n=>n.style.transform).join('|') !== old,previous);
        assert.equal(await page.locator('.atlas-inspector').count(),0);
      };
      await gesture([[180,575]],[[225,550]]);
      await gesture([[155,575],[235,575]],[[125,575],[265,575]]);
      await page.setViewportSize({width:height,height:width});
      await page.waitForFunction(h=>document.querySelector('canvas').clientHeight===h,width);
      await page.setViewportSize({width,height});
      await page.reload();
    }
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
