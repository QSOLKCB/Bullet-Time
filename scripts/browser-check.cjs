// Browser smoke test: serves the game, renders it in Chromium (software WebGL),
// drives real gameplay through the ?test hook and saves screenshots to artifacts/.
// Playwright is CI tooling only, never a game dependency.
const {chromium} = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.argv[2] || '.'), out = path.resolve('artifacts');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json'};
fs.mkdirSync(out, {recursive:true});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream'}); fs.createReadStream(file).pipe(res);
});
const fail = message => { console.error('FAIL:', message); process.exitCode = 1; };
(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport:{width:1280, height:720}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else if (m.text().startsWith('killcam')) console.log(m.text()); });
  await page.goto(base + '?test');
  await page.waitForTimeout(1500);
  const shot = async name => { await page.screenshot({path:path.join(out, name + '.png')}); console.log('screenshot', name); };
  // Read back inside the next animation frame, after the game has drawn it.
  const lit = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const c = document.getElementById('world'), g = c.getContext('webgl2') || c.getContext('webgl'), px = new Uint8Array(4*64);
    let sum = 0; for (let i = 0; i < 8; i++) { g.readPixels(Math.floor(c.width*(i+1)/9), Math.floor(c.height/2), 8, 8, g.RGBA, g.UNSIGNED_BYTE, px); for (let j = 0; j < px.length; j += 4) sum += px[j] + px[j+1] + px[j+2]; }
    resolve(sum);
  })));
  if (await page.locator('#error').isVisible()) fail('graphics error: ' + await page.locator('#error').textContent());
  await shot('01-menu');
  // Skins: open the wardrobe, pick a finish for the pistols and a look for the enemies.
  await page.click('#skins-open'); await page.waitForTimeout(300);
  if ((await page.locator('#skins .skin').count()) < 10) fail('skin picker is missing options');
  const broken = await page.evaluate(() => [...document.querySelectorAll('#skins img')].filter(i => !i.complete || !i.naturalWidth).map(i => i.src));
  if (broken.length) fail('skin swatches failed to load: ' + broken.join(', '));
  await shot('00-skins');
  await page.click('#skins .skin[data-group="duals"][data-skin="ember"]');
  await page.click('#skins .skin[data-group="enemies"][data-skin="nightshift"]');
  const chosen = await page.evaluate(() => JSON.parse(localStorage.getItem('bullettime.settings')).skins);
  if (chosen.duals !== 'ember' || chosen.enemies !== 'nightshift') fail('skin choice was not saved');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const t = globalThis.__bulletTime; t.startRun(); t.beginPlaying(); });
  await page.waitForFunction(() => __bulletTime.game.bots.length > 0, null, {timeout:15000}).catch(() => {});
  await page.waitForTimeout(800);
  const s1 = await page.evaluate(() => { const g = __bulletTime.game; return {state:__bulletTime.state, wave:g.wave, bots:g.bots.length}; });
  console.log('playing', s1);
  if (s1.state !== 'playing' || s1.wave < 1) fail('game did not start a wave');
  // Aim at the nearest enemy, enter bullet time with the real key binding and fire.
  const aim = () => page.evaluate(() => {
    const g = __bulletTime.game, p = g.player, b = g.bots.slice().sort((a, c) => Math.hypot(a.x-p.x, a.z-p.z) - Math.hypot(c.x-p.x, c.z-p.z))[0];
    if (!b) return false; const dx = b.x-p.x, dz = b.z-p.z, d = Math.hypot(dx, dz);
    p.yaw = Math.atan2(dx, -dz); p.pitch = Math.atan2(1.3 - p.eye, d); return true;
  });
  await aim();
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(400);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => __bulletTime.game.requestShot()); await page.waitForTimeout(120); }
  const s2 = await page.evaluate(() => ({slow:__bulletTime.game.slow, bullets:__bulletTime.game.bullets.length, focus:__bulletTime.game.focus}));
  console.log('bullet time', s2);
  if (s2.slow < 0.9) fail('Q did not engage bullet time');
  if (s2.bullets < 1) fail('no visible bullets in flight during bullet time');
  await shot('02-bullet-time');
  if (await lit() < 2000) fail('world canvas appears blank');
  await page.keyboard.press('KeyQ');
  // Shootdodge with the real binding (hold D, tap Shift).
  await page.waitForTimeout(500); await aim();
  await page.keyboard.down('KeyD'); await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(260);
  const s3 = await page.evaluate(() => ({diving:__bulletTime.game.player.diving, slow:__bulletTime.game.slow, roll:__bulletTime.game.player.roll}));
  await page.evaluate(() => __bulletTime.game.requestShot());
  await page.waitForTimeout(120);
  await shot('03-shootdodge');
  await page.keyboard.up('KeyD');
  console.log('dive', s3);
  if (!s3.diving || s3.slow < 0.5) fail('shootdodge did not dive in slow motion');
  // Glass: shoot the nearest pane.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const g = __bulletTime.game, p = g.player, pane = g.glass.find(q => q.intact);
    g.player.invulnerable = 99; Object.assign(p, {x:pane.x + (pane.w > 1 ? 0 : 4), z:pane.z + (pane.w > 1 ? 4 : 0)});
    const dx = pane.x - p.x, dz = pane.z - p.z; p.yaw = Math.atan2(dx, -dz); p.pitch = Math.atan2(1.2 - p.eye, Math.hypot(dx, dz));
    g.toggleFocus(); g.switchWeapon(1);
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => __bulletTime.game.requestShot());
  await page.waitForTimeout(500);
  const glass = await page.evaluate(() => ({broken:__bulletTime.game.stats.glass, shards:__bulletTime.effects.shards.length}));
  console.log('glass', glass);
  if (!glass.broken || !glass.shards) fail('glass did not shatter');
  await shot('04-glass');
  // Final-kill bullet camera: leave one bot, line up a headshot and fire.
  await page.evaluate(() => {
    const g = __bulletTime.game; if (g.focusOn) g.toggleFocus();
    g.queue = []; g.bots = g.bots.slice(0, 1); g.switchWeapon(0);
    const b = g.bots[0] || g.spawnBot('grunt'); g.bots = [b];
    // A clear lane between the west colonnade and the benches.
    Object.assign(b, {x:-6, z:-12, think:99, wait:99, moveX:0, moveZ:0, charge:0, burst:0, evade:0});
    const p = g.player; Object.assign(p, {x:-6, z:2, y:0, vy:0, diving:false, prone:0, crouch:false, eye:1.68}); g.glass.forEach(q => { q.intact = false; }); g.refreshBlockers();
    p.yaw = 0; p.pitch = Math.atan2(1.95 - p.eye, 14);
  });
  await page.waitForFunction(() => { const w = __bulletTime.game.weapon; return w.switching === 0 && w.cooldown === 0 && w.reload === 0; }, null, {timeout:5000});
  await page.waitForTimeout(200);
  const started = await page.evaluate(() => {
    const g = __bulletTime.game, w = g.weapon, b = g.bots[0];
    const why = {reload:w.reload, switching:w.switching, cooldown:w.cooldown, ammo:g.ammo[w.index], final:g.isFinalTarget(), hp:b?.hp, alive:b?.alive, bots:g.bots.length, queue:g.queue.length, busy:g.busy, killcamOption:g.options.killcam, eye:g.player.eye};
    g.requestShot(); if (!g.killcam) console.log('killcam diagnostics', JSON.stringify(why)); return !!g.killcam;
  });
  await page.waitForTimeout(700);
  await shot('05-bullet-cam');
  await page.waitForFunction(() => __bulletTime.game.killcam?.phase === 'impact', null, {timeout:8000}).catch(() => fail('bullet camera never reached the impact orbit'));
  await page.waitForTimeout(350);
  await shot('06-final-kill-orbit');
  console.log('killcam', started);
  if (!started) fail('final kill did not start the bullet camera');
  await page.waitForTimeout(2500);
  const s4 = await page.evaluate(() => ({killcam:!!__bulletTime.game.killcam, waves:__bulletTime.game.stats.waves}));
  console.log('after killcam', s4);
  if (s4.killcam || s4.waves < 1) fail('bullet camera did not hand back control after clearing the wave');
  // Incoming fire seen in bullet time: a burst from a gunman ahead of the player.
  await page.waitForFunction(() => !__bulletTime.game.killcam, null, {timeout:8000});
  await page.evaluate(() => {
    const g = __bulletTime.game, p = g.player; g.breakTimer = 999; g.player.invulnerable = 99;
    const b = g.spawnBot('grunt'); Object.assign(b, {x:-6, z:-9, think:99, wait:99, moveX:0, moveZ:0}); g.bots = [b];
    Object.assign(p, {x:-6, z:2}); p.yaw = 0.18; p.pitch = -0.04; b.yaw = Math.atan2(-(p.x - b.x), -(p.z - b.z));
    g.fireEnemy(b); g.focus = 100; g.toggleFocus();
  });
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(260); await page.evaluate(() => __bulletTime.game.fireEnemy(__bulletTime.game.bots[0])); }
  await page.waitForTimeout(400);
  const incoming = await page.evaluate(() => __bulletTime.game.bullets.filter(b => b.owner === 'enemy').length);
  console.log('incoming rounds', incoming);
  if (incoming < 2) fail('enemy rounds were not in flight');
  await shot('07-incoming');
  // Pause and resume lifecycle.
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  if (!(await page.locator('#pause').isVisible())) fail('Escape did not pause');
  await shot('08-pause');
  // Death → results.
  await page.evaluate(() => { const t = __bulletTime; t.beginPlaying(); t.game.player.invulnerable = 0; t.game.damage(500, [0, 1, 0]); });
  await page.waitForTimeout(2600);
  if (!(await page.locator('#results').isVisible())) fail('death did not reach the results screen');
  await shot('09-results');
  if (errors.length) fail('console errors:\n' + errors.join('\n'));
  await browser.close(); server.close();
  console.log(process.exitCode ? 'Browser check FAILED' : 'Browser check passed');
})().catch(e => { console.error(e); process.exit(1); });
