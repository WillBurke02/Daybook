// node tests/sim-look.mjs <scene> [out.png] [script|press:start,wait:3,…] (FAULT=<id> for a fault) — a picture of a machine, for whoever
// writes one: it mounts the scene in a real browser, optionally plays its demo script (or presses and waits),
// screenshots it and prints the page's errors and the machine's main readings.
// Needs Playwright and a Daybook running: python3 demo.py /tmp/demo && python3 daybook.py serve --data /tmp/demo --port 8799
// ponytail: a tool for authors, not a test; BASE and PLAYWRIGHT can point it elsewhere.
import { createRequire } from 'node:module';

const [name, out = `${name}.png`, plan = ''] = process.argv.slice(2);
if (!name) { console.log('usage: node tests/sim-look.mjs <scene> [out.png] [script | press:start,wait:3,set:ref=30]'); process.exit(1); }
const base = process.env.BASE || 'http://127.0.0.1:8799';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1000, height: 1300 } });
const errs = [];
p.on('pageerror', e => errs.push(`page error: ${e.message}`));
p.on('console', m => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
await p.goto(`${base}/login`);
await p.fill('input[type=password]', process.env.PASSWORD || 'pass');
await p.keyboard.press('Enter');
await p.waitForTimeout(700);
await p.goto(`${base}/learn/`);
await p.waitForTimeout(600);
const ok = await p.evaluate(async ([scene, fault]) => {
  document.body.innerHTML = '<main style="max-width:860px;margin:16px auto;padding:0 16px"><div class="widget" id="w"></div></main>';
  try { window.api = await (await import('/learn/widgets/sim.js')).mount(document.getElementById('w'), { scene, fault, plc: 'open' }, () => {}); return true; }
  catch (e) { return e.message; }
}, [name, process.env.FAULT || null]);
if (ok !== true) errs.push(`mount: ${ok}`);
for (const step of plan === 'script' ? [] : plan.split(',').filter(Boolean)) {
  const [verb, arg = ''] = step.split(':');
  if (verb === 'press') await p.evaluate(n => api.press(n), arg);
  if (verb === 'wait') await p.waitForTimeout(+arg * 1000);
  if (verb === 'set') await p.evaluate(([k, v]) => { api.sim.env[k] = +v; }, arg.split('='));
}
if (plan === 'script') {
  await p.evaluate(() => api.restart(api.scene.script));   // (the fault, if one is set, stays in)
  await p.waitForTimeout(1000 * Math.max(3, ...(await p.evaluate(() => (api.scene.script || []).map(e => (e.at || 0) + 1)))));
}
await p.waitForTimeout(400);
await p.screenshot({ path: out, fullPage: true });
if (ok === true) console.log(await p.evaluate(() => `t = ${api.sim.t.toFixed(1)} s · ${api.sim.said}\n` + (document.querySelector('.s3read')?.innerText || '').replace(/\n/g, ' · ')));
console.log(errs.join('\n') || 'no errors', `\nwrote ${out}`);
await b.close();
