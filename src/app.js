import {Game, RULES, WEAPONS} from './game.js';
import {Renderer} from './renderer.js';
import {Sound} from './audio.js';
import {XboxInput} from './controller.js';
import {FixedClock} from './clock.js';
import {FrameGate} from './frame-gate.js';
import {clamp, seededRandom} from './math.js';
import {WEAPON_SKINS, ENEMY_SKINS, normalizeSkins} from './skins.js';
// Browser shell: input, lifecycle, effects, Canvas overlay and HUD. The pure
// simulation lives in game.js (structure adapted from QSOLKCB/QUICKSCOPER).
const $ = id => document.getElementById(id), canvas = $('world'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const sound = new Sound(), controller = new XboxInput(), clock = new FixedClock({step:1/120, maxFrame:0.1, snapTolerance:0.0005}), fx = seededRandom(4242);
// Paused and results screens show a frozen world: the gate redraws it only when
// something that feeds the image changes, instead of every display refresh.
const frameGate = new FrameGate();
let contextEpoch = 0;
document.addEventListener('pointerdown', () => { if (sound.context?.state !== 'running') sound.start(); }, {passive:true});
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } }
};
const prefs = {sensitivity:1, padSensitivity:1, deadzone:0.16, volume:0.5, musicVolume:0.3, profile:'mouse', invert:false, focusHold:false, killcam:true,
  reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, lowQuality:false, skins:normalizeSkins()};
const stored = storage.get('bullettime.settings', {});
if (stored && typeof stored === 'object') {
  for (const [key, min, max] of [['sensitivity',0.3,2.5],['padSensitivity',0.3,2.5],['deadzone',0.05,0.35],['volume',0,1],['musicVolume',0,1]]) if (Number.isFinite(stored[key])) prefs[key] = clamp(stored[key], min, max);
  if (['mouse','xbox'].includes(stored.profile)) prefs.profile = stored.profile;
  for (const key of ['invert','focusHold','killcam','reduced','lowQuality']) if (typeof stored[key] === 'boolean') prefs[key] = stored[key];
  prefs.skins = normalizeSkins(stored.skins);
}
let best = storage.get('bullettime.best', 0); if (!Number.isFinite(best) || best < 0) best = 0;
let selectedMode = 'run', game = new Game('practice', 3), renderer = null, graphicsLost = false, state = 'menu';
let keys = new Set(), mouseFire = false, mouseFocus = false, queuedJump = false, queuedDive = false, pad = {}, last = 0, hudElapsed = 0, heartTimer = 0;
let controllerStatus = '', announcementUntil = 0, hitTime = 0, hitHead = false, hitKilled = false, damageTime = 0, feed = [];
const effects = {particles:[], rings:[], flashes:[], shards:[], casings:[], labels:[], indicators:[], fovKick:0, shake:0, wave:0, denied:0};
const particlePool = [];

function showError(message) { $('error').hidden = false; $('error').textContent = message; }
function clearInput() {
  keys.clear(); mouseFire = false; mouseFocus = false; queuedJump = false; queuedDive = false;
  pad = {connected:pad.connected}; controller.reset(); game.cancelShot();
  if (prefs.focusHold) game.setFocus(false);
}
function resetEffects() {
  particlePool.push(...effects.particles);
  for (const key of ['particles','rings','flashes','shards','casings','labels','indicators']) effects[key].length = 0;
  effects.fovKick = 0; effects.shake = 0; effects.wave = 0; feed = []; hitTime = 0; damageTime = 0; announcementUntil = 0;
  $('announcement').replaceChildren(); $('kill-feed').replaceChildren(); document.body.classList.remove('cinematic', 'slow');
}
function updateBest() { $('best-score').textContent = `PERSONAL BEST ${best ? best.toLocaleString() : '—'}`; }
function chooseMode(mode) {
  selectedMode = mode;
  for (const name of ['run','practice']) { const b = $(`mode-${name}`); b.classList.toggle('active', mode === name); b.setAttribute('aria-pressed', String(mode === name)); }
}
$('mode-run').onclick = () => chooseMode('run'); $('mode-practice').onclick = () => chooseMode('practice');

// ---- Settings ---------------------------------------------------------------
function syncPrefs() {
  $('sensitivity').value = prefs.sensitivity; $('sens-output').value = prefs.sensitivity.toFixed(2);
  $('pad-sensitivity').value = prefs.padSensitivity; $('pad-output').value = prefs.padSensitivity.toFixed(2);
  $('deadzone').value = prefs.deadzone; $('deadzone-output').value = `${Math.round(prefs.deadzone*100)}%`;
  $('volume').value = prefs.volume; $('volume-output').value = `${Math.round(prefs.volume*100)}%`;
  $('music-volume').value = prefs.musicVolume; $('music-output').value = `${Math.round(prefs.musicVolume*100)}%`;
  for (const [id, key] of [['invert','invert'],['reduced','reduced'],['low-quality','lowQuality'],['focus-hold','focusHold'],['killcam','killcam']]) $(id).checked = prefs[key];
  $('profile').value = prefs.profile; $('control-profile').value = prefs.profile;
  const xbox = prefs.profile === 'xbox';
  $('menu-note').textContent = xbox ? 'XBOX · A TO START · CLICK ONCE FOR AUDIO' : 'KEYBOARD + MOUSE · ESC TO PAUSE';
  $('guide-focus').textContent = xbox ? 'LT' : 'Q / RMB'; $('guide-dive').textContent = xbox ? 'B' : 'SHIFT';
  $('guide-fire').textContent = xbox ? 'RT' : 'LMB'; $('guide-weapons').textContent = xbox ? 'Y / LB / RB' : '1–6';
  sound.setVolume(prefs.volume); sound.setMusicVolume(prefs.musicVolume); game.options.killcam = prefs.killcam;
  renderer?.setSkins(prefs.skins); syncSkinButtons(); frameGate.invalidate();
  storage.set('bullettime.settings', prefs);
}
for (const [id, key] of [['sensitivity','sensitivity'],['pad-sensitivity','padSensitivity'],['deadzone','deadzone'],['volume','volume'],['music-volume','musicVolume'],
  ['invert','invert'],['reduced','reduced'],['low-quality','lowQuality'],['focus-hold','focusHold'],['killcam','killcam']]) {
  $(id).addEventListener('input', () => { prefs[key] = $(id).type === 'checkbox' ? $(id).checked : Number($(id).value); syncPrefs(); });
}
for (const id of ['profile','control-profile']) $(id).addEventListener('change', () => { prefs.profile = $(id).value; clearInput(); syncPrefs(); });
function openSettings() { sound.start(); $('settings').showModal(); }
$('settings-open').onclick = openSettings; $('pause-settings').onclick = openSettings;
// ---- Skins ------------------------------------------------------------------
const SKIN_GROUPS = [
  ...WEAPONS.map(w => ({key:w.id, title:`${w.name} / ${w.kind}`, skins:WEAPON_SKINS, prefix:'weapon'})),
  {key:'enemies', title:'THE OPPOSITION', skins:ENEMY_SKINS, prefix:'enemy'}
];
function buildSkins() {
  const root = $('skin-groups');
  for (const group of SKIN_GROUPS) {
    const section = document.createElement('section'), heading = document.createElement('h3'), row = document.createElement('div');
    section.className = 'skin-group'; heading.textContent = group.title; row.className = 'skin-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', group.title);
    for (const [id, skin] of Object.entries(group.skins)) {
      const button = document.createElement('button'), img = document.createElement('img'), name = document.createElement('b'), note = document.createElement('small');
      button.type = 'button'; button.className = 'skin'; button.dataset.group = group.key; button.dataset.skin = id;
      img.src = `./assets/skins/${group.prefix}-${id}.svg`; img.alt = ''; img.width = 100; img.height = 80;
      name.textContent = skin.name; note.textContent = skin.note;
      button.append(img, name, note);
      button.onclick = () => { prefs.skins = normalizeSkins({...prefs.skins, [group.key]:id}); syncPrefs(); };
      row.append(button);
    }
    section.append(heading, row); root.append(section);
  }
}
function syncSkinButtons() {
  for (const b of document.querySelectorAll('.skin')) b.setAttribute('aria-pressed', String(prefs.skins[b.dataset.group] === b.dataset.skin));
}
function openSkins() { sound.start(); $('skins').showModal(); }
$('skins-open').onclick = openSkins; $('pause-skins').onclick = openSkins;
buildSkins(); $('help-open').onclick = () => $('help').showModal();

// ---- Lifecycle --------------------------------------------------------------
function setScreen(next) {
  state = next; frameGate.invalidate(); if (next !== 'playing') sound.stopMusic();
  $('menu').hidden = next !== 'menu'; $('pause').hidden = next !== 'paused'; $('results').hidden = next !== 'results'; $('hud').hidden = next === 'menu' || next === 'results';
  if (next !== 'playing') sound.setSlow(0);
}
function beginPlaying() { setScreen('playing'); clearInput(); last = performance.now(); clock.reset(); }
function requestLock() {
  if (!renderer) return;
  $('lock-message').textContent = ''; sound.start();
  if (prefs.profile === 'xbox') {
    if (!pad.connected) { $('lock-message').textContent = 'Connect an Xbox controller and press a button to wake it, then resume. You can also choose keyboard + mouse in Settings.'; return; }
    beginPlaying(); return;
  }
  if (!canvas.requestPointerLock) { $('lock-message').textContent = 'This browser needs Pointer Lock support. Try a desktop browser with a mouse.'; return; }
  try {
    const result = canvas.requestPointerLock({unadjustedMovement:true});
    result?.catch?.(() => { try { canvas.requestPointerLock()?.catch?.(() => { $('lock-message').textContent = 'Mouse capture was blocked. Click Back into it to try again.'; }); } catch { /* Reported below. */ } });
  } catch { $('lock-message').textContent = 'Mouse capture was blocked. Click Back into it to try again.'; }
}
function startRun() {
  if (!renderer) return;
  game = new Game(selectedMode, Date.now() >>> 0, {killcam:prefs.killcam}); clearInput(); resetEffects(); clock.reset();
  $('hud-mode').textContent = selectedMode === 'run' ? 'THE GAUNTLET / ONE LIFE' : 'THE RANGE / PRACTICE';
  setScreen('paused'); requestLock(); sound.play('start');
  announce(selectedMode === 'run' ? 'THE CLOCK IS YOURS.' : 'TAKE YOUR TIME.', selectedMode === 'run' ? 'Hostiles inbound. Bend time, dive, survive.' : 'No incoming fire. Practise your dives and timing.', 2.4);
  updateHUD();
}
function pauseGame() {
  if (state !== 'playing') return;
  clearInput(); setScreen('paused');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  $('resume').focus();
}
function menu() {
  clearInput(); setScreen('menu'); if (document.pointerLockElement) document.exitPointerLock();
  resetEffects(); game = new Game('practice', 3); updateBest(); $('start').focus();
}
$('start').onclick = startRun; $('restart').onclick = startRun; $('play-again').onclick = startRun;
$('resume').onclick = requestLock; $('quit').onclick = menu; $('results-menu').onclick = menu;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) { if (state === 'paused') beginPlaying(); else if (state !== 'playing') document.exitPointerLock(); }
  else if (state === 'playing' && prefs.profile === 'mouse') pauseGame();
});
document.addEventListener('pointerlockerror', () => { if (state === 'paused') $('lock-message').textContent = 'Click Back into it to capture the mouse. If blocked, open this page directly in a desktop browser.'; });
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---- Keyboard and mouse -----------------------------------------------------
const HANDLED = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ControlLeft','ControlRight','ShiftLeft','ShiftRight','KeyC','KeyR','KeyM','KeyQ','KeyF','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6'];
function focusPress(down) {
  if (prefs.focusHold) game.setFocus(down);
  else if (down) game.toggleFocus();
  consumeEvents();
}
window.addEventListener('keydown', e => {
  if (state !== 'playing') return;
  if (['KeyP','Escape','Tab'].includes(e.code)) { e.preventDefault(); pauseGame(); return; }
  if (HANDLED.includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyR') game.reload();
  if (e.code === 'KeyQ') focusPress(true);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyF') queuedDive = true;
  if (e.code === 'Space') queuedJump = true;
  if (e.code.startsWith('Digit')) game.switchWeapon(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyM') announce(sound.toggle() ? 'SOUND OFF' : 'SOUND ON', '', 0.8);
  consumeEvents();
});
window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyQ' && prefs.focusHold && state === 'playing') focusPress(false); });
window.addEventListener('mousemove', e => {
  if (state !== 'playing' || prefs.profile !== 'mouse' || document.pointerLockElement !== canvas || game.killcam || game.dying > 0) return;
  // Look is applied in real time: bullet time never slows your aim.
  const scale = 0.0021*prefs.sensitivity, p = game.player;
  p.yaw += clamp(e.movementX, -400, 400)*scale;
  p.pitch = clamp(p.pitch - clamp(e.movementY, -400, 400)*scale*(prefs.invert ? -1 : 1), -1.45, 1.45);
});
window.addEventListener('mousedown', e => {
  if (state !== 'playing' || prefs.profile !== 'mouse' || document.pointerLockElement !== canvas) return;
  e.preventDefault();
  if (e.button === 0) { mouseFire = true; game.requestShot(); }
  if (e.button === 2) { mouseFocus = true; focusPress(true); }
  if (e.button === 1) queuedDive = true;
  consumeEvents();
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouseFire = false;
  if (e.button === 2) { mouseFocus = false; if (prefs.focusHold && state === 'playing') focusPress(false); }
});
window.addEventListener('wheel', e => { if (state === 'playing' && Math.abs(e.deltaY) > 4) { game.cycleWeapon(e.deltaY > 0 ? 1 : -1); consumeEvents(); } }, {passive:true});
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('contextmenu', e => { if (state === 'playing') e.preventDefault(); });
const down = (...codes) => codes.some(c => keys.has(c));
function input() {
  const jump = queuedJump, dive = queuedDive; queuedJump = false; queuedDive = false;
  if (prefs.profile === 'xbox') return {moveX:pad.moveX || 0, moveZ:pad.moveZ || 0, crouch:!!pad.crouch, fire:!!pad.fireHeld, jump, dive};
  return {forward:down('KeyW','ArrowUp'), back:down('KeyS','ArrowDown'), left:down('KeyA','ArrowLeft'), right:down('KeyD','ArrowRight'),
    crouch:down('KeyC','ControlLeft','ControlRight'), fire:mouseFire, jump, dive};
}

// ---- Controller -------------------------------------------------------------
function pollController() {
  const wasConnected = pad.connected;
  try { pad = controller.sample(navigator.getGamepads?.(), prefs.deadzone); } catch { pad = {connected:false}; }
  const message = pad.connected ? 'XBOX READY · RELEASE CONTROLS AFTER RESUMING' : 'XBOX: CONNECT, THEN PRESS A BUTTON';
  if (message !== controllerStatus) { controllerStatus = message; $('controller-status').textContent = message; $('controller-settings-status').textContent = message; }
  if (state === 'playing' && prefs.profile === 'xbox' && ((wasConnected && !pad.connected) || pad.replaced)) { pauseGame(); $('lock-message').textContent = 'Controller disconnected or changed. Reconnect, release the controls, then resume.'; return; }
  if (prefs.profile !== 'xbox' || !pad.connected || document.hidden || !document.hasFocus()) return;
  if (state === 'playing') {
    if (pad.pause) { pauseGame(); return; }
    queuedJump ||= pad.jump; queuedDive ||= pad.dive;
    if (prefs.focusHold) { if (pad.focusHeld !== game.focusOn) game.setFocus(pad.focusHeld); } else if (pad.focus) game.toggleFocus();
    if (pad.fire) game.requestShot();
    if (pad.reload) game.reload();
    if (pad.next) game.cycleWeapon(1); if (pad.prev) game.cycleWeapon(-1);
    consumeEvents(); return;
  }
  const dialog = document.querySelector('dialog[open]');
  if (dialog && pad.back) { dialog.close(); return; }
  if (!dialog && state === 'paused' && pad.pause) { requestLock(); return; }
  const root = dialog || $(state === 'paused' ? 'pause' : state === 'results' ? 'results' : 'menu');
  const controls = Array.from(root.querySelectorAll('button,input,select')).filter(n => !n.disabled && n.getClientRects().length);
  let current = controls.indexOf(document.activeElement);
  if (pad.up || pad.down) { current = (current + (pad.up ? -1 : 1) + controls.length) % controls.length; controls[current]?.focus(); }
  const node = controls[current];
  if ((pad.left || pad.right) && node) {
    if (node.tagName === 'SELECT') { node.selectedIndex = (node.selectedIndex + (pad.left ? -1 : 1) + node.options.length) % node.options.length; node.dispatchEvent(new Event('change')); }
    if (node.type === 'range') { node.value = clamp(Number(node.value) + (pad.left ? -1 : 1)*Number(node.step || 0.05), Number(node.min), Number(node.max)); node.dispatchEvent(new Event('input')); }
  }
  if (pad.accept) {
    if (node && node.tagName !== 'SELECT' && node.type !== 'range') node.click();
    else if (!dialog && current < 0) (state === 'menu' ? $('start') : state === 'paused' ? $('resume') : $('play-again')).click();
  }
}

// ---- Events → sound, effects and HUD ----------------------------------------
function announce(title, subtitle = '', seconds = 1) {
  const node = $('announcement'); node.replaceChildren(document.createTextNode(title));
  if (subtitle) { const sub = document.createElement('small'); sub.textContent = subtitle; node.append(sub); }
  announcementUntil = performance.now()/1000 + seconds;
}
function pushFeed(text, seconds = 3) { feed.unshift({text, until:performance.now()/1000 + seconds}); feed = feed.slice(0, 4); renderFeed(); }
function renderFeed() { const node = $('kill-feed'); node.replaceChildren(); for (const f of feed) { const row = document.createElement('div'); row.textContent = f.text; node.append(row); } }
const quality = () => prefs.reduced ? 0.25 : prefs.lowQuality ? 0.5 : 1;
function particles(point, count, color, {speed = 3, up = 2, size = 0.05, life = 0.8, gravity = 9, spread = 0, dir = null} = {}) {
  count = Math.max(1, Math.round(count*quality()));
  const cap = prefs.reduced ? 60 : prefs.lowQuality ? 180 : 420;
  for (let i = 0; i < count && effects.particles.length < cap; i++) {
    const p = particlePool.pop() || {}, a = fx()*Math.PI*2, v = speed*(0.3 + fx()*0.7);
    Object.assign(p, {x:point[0] + (fx()-0.5)*spread, y:point[1] + (fx()-0.5)*spread, z:point[2] + (fx()-0.5)*spread,
      vx:Math.cos(a)*v + (dir ? -dir[0]*speed*0.6 : 0), vy:up*(0.2 + fx()), vz:Math.sin(a)*v + (dir ? -dir[2]*speed*0.6 : 0),
      size:size*(0.5 + fx()), life:life*(0.5 + fx()*0.7), color, gravity});
    effects.particles.push(p);
  }
}
function glassBurst(e) {
  const g = e.pane, n = Math.round(42*quality()), cap = 240;
  for (let i = 0; i < n && effects.shards.length < cap; i++) {
    const x = g.min[0] + fx()*(g.max[0]-g.min[0]), y = g.min[1] + fx()*(g.max[1]-g.min[1]), z = g.min[2] + fx()*(g.max[2]-g.min[2]);
    const near = Math.max(0, 1 - Math.hypot(x-e.point[0], y-e.point[1], z-e.point[2])/2.5), push = 1 + near*5;
    effects.shards.push({x, y, z, vx:e.dir[0]*push*(0.5 + fx()) + (fx()-0.5)*1.5, vy:(fx()-0.3)*2 + near, vz:e.dir[2]*push*(0.5 + fx()) + (fx()-0.5)*1.5,
      yaw:fx()*6, tilt:fx()*6, spinY:(fx()-0.5)*14, spinT:(fx()-0.5)*14, size:0.06 + fx()*0.2, life:2.5 + fx()*1.5, color:[0.62,0.8,0.86]});
  }
  particles(e.point, 30, [0.6,0.8,0.9], {speed:4, up:2, size:0.03, spread:1.2, dir:[-e.dir[0],0,-e.dir[2]]});
}
// Screen shake per trigger pull; anything unlisted gets a light kick.
const SHAKE = {shotgun:1, revolver:0.8, rifle:0.9, vipers:0.2};
function consumeEvents() {
  const now = performance.now()/1000;
  for (const e of game.drainEvents()) {
    switch (e.type) {
      case 'shot': {
        sound.play('shot', e); effects.shake = Math.max(effects.shake, SHAKE[e.weapon] ?? 0.35);
        const p = game.player, cs = Math.cos(p.yaw), sn = Math.sin(p.yaw), f = [sn, 0, -cs], r = [cs, 0, sn];
        if (effects.casings.length < 40 && e.weapon !== 'shotgun' && e.weapon !== 'revolver') { // A revolver keeps its brass.
          const o = e.origin, h = e.hand || 1;
          effects.casings.push({x:o[0] + r[0]*0.3*h + f[0]*0.6, y:o[1] - 0.14, z:o[2] + r[2]*0.3*h + f[2]*0.6,
            vx:r[0]*h*2.6 + f[0]*0.4 + (fx()-0.5)*0.6, vy:1.6 + fx(), vz:r[2]*h*2.6 + f[2]*0.4 + (fx()-0.5)*0.6, yaw:fx()*6, tilt:0, spinY:8 + fx()*8, spinT:12 + fx()*10, life:2.5});
        }
        break;
      }
      case 'enemyShot': sound.play('enemyShot'); effects.flashes.push({pos:e.origin, life:0.06, size:e.type === 'heavy' ? 0.45 : 0.3}); break;
      case 'whiz': sound.play('whiz'); break;
      case 'impact':
        if (e.owner === 'player') sound.play('impact');
        particles(e.point, 9, [1, 0.62, 0.3], {speed:3.5, up:2.5, size:0.035, life:0.5, dir:e.dir});
        particles(e.point, 5, [0.45, 0.42, 0.38], {speed:1.2, up:1, size:0.08, life:1.2, gravity:2, dir:e.dir});
        break;
      case 'hit':
        sound.play('hit'); hitTime = 0.2; hitHead = e.head; hitKilled = e.killed;
        if (e.head) sound.play('headshot');
        particles(e.point, e.killed ? 22 : 10, e.head ? [1, 0.75, 0.35] : [0.55, 0.9, 1], {speed:3, up:2, size:0.04, life:0.7, dir:e.dir});
        break;
      case 'kill': {
        sound.play('kill');
        particles(e.position.map((v, i) => v + (i === 1 ? 1.2 : 0)), 26, [1, 0.55, 0.25], {speed:2.5, up:2, size:0.05, life:1, spread:0.8, gravity:4});
        effects.labels.push({point:[...e.point], text:`+${e.points}`, life:1.1});
        const tags = [e.head && 'HEADSHOT', e.slow && 'BULLET TIME', e.air && 'MID-DIVE', e.long && 'LONG SHOT'].filter(Boolean);
        pushFeed(`${tags.length ? tags.join(' · ') : 'ELIMINATED'}  +${e.points}`);
        if (e.combo >= 2) announce(`${Math.min(e.combo, 5)}× ${e.combo >= 5 ? 'UNTOUCHABLE' : e.combo >= 3 ? 'CHAIN REACTION' : 'DOUBLE TAP'}`, e.air ? 'MID-DIVE BONUS' : e.slow ? 'BULLET TIME BONUS' : 'KEEP THE CHAIN ALIVE', 0.9);
        break;
      }
      case 'glass': sound.play('glass'); glassBurst(e); if (game.stats.glass === 1 && state === 'playing') pushFeed('GLASS DOESN’T STOP BULLETS', 2.5); break;
      case 'focusOn': sound.play('focusOn'); effects.wave = 1; effects.fovKick = 6; break;
      case 'focusOff': sound.play('focusOff'); effects.fovKick = -3; if (e.empty) announce('OUT OF TIME', 'Kills refill the hourglass', 1); break;
      case 'focusDenied': sound.play('focusDenied'); effects.denied = 0.6; break;
      case 'dive': sound.play('dive'); effects.fovKick = 5; if (!game.focusOn) effects.wave = 0.6; break;
      case 'land': sound.play('land'); effects.shake = Math.max(effects.shake, 1.2); break;
      case 'reload': case 'loaded': case 'switch': sound.play(e.type); break;
      case 'damage': {
        sound.play('damage'); damageTime = 0.4;
        if (e.from) effects.indicators.push({x:e.from[0], z:e.from[2], life:1.2});
        break;
      }
      case 'death': sound.play('death'); announce('DOWN.', 'The clock always wins in the end.', 2); break;
      case 'spawn': sound.play('spawn'); break;
      case 'wave': sound.play('wave'); if (state === 'playing' || game.mode === 'run') announce(`WAVE ${String(e.wave).padStart(2, '0')}`, `${e.count} hostiles inbound`, 1.8); break;
      case 'waveClear': sound.play('waveClear'); announce('WAVE CLEARED', `+${e.bonus} · vitals and hourglass restored`, 2.2); pushFeed(`WAVE ${e.wave} CLEARED  +${e.bonus}`, 4); break;
      case 'killcamStart': sound.play('killcamStart'); document.body.classList.add('cinematic'); break;
      case 'killcamImpact': sound.play('killcamImpact'); break;
      case 'killcamEnd': document.body.classList.remove('cinematic'); break;
      case 'end': finish(); break;
    }
  }
  if (announcementUntil && now > announcementUntil) { $('announcement').replaceChildren(); announcementUntil = 0; }
}
function compact(array, update, onExpire) {
  let write = 0;
  for (let read = 0; read < array.length; read++) { const v = array[read]; update(v); if (v.life > 0) array[write++] = v; else onExpire?.(v); }
  array.length = write;
}
// Effects run on the world clock: debris and glass hang in the air in bullet time.
function updateEffects(dt) {
  const w = dt*game.timeScale, drag = Math.exp(-1.6*w);
  compact(effects.particles, p => {
    p.life -= w; p.vy -= p.gravity*w; p.x += p.vx*w; p.y += p.vy*w; p.z += p.vz*w; p.vx *= drag; p.vz *= drag;
    if (p.y < 0.02) { p.y = 0.02; p.vy = Math.abs(p.vy)*0.25; }
  }, p => particlePool.push(p));
  const tumble = s => {
    s.life -= w; s.vy -= 9.8*w; s.x += s.vx*w; s.y += s.vy*w; s.z += s.vz*w; s.yaw += s.spinY*w; s.tilt += s.spinT*w;
    if (s.y < 0.02) { s.y = 0.02; s.vy = Math.abs(s.vy)*0.2; s.vx *= 0.5; s.vz *= 0.5; s.spinY *= 0.5; s.spinT *= 0.5; }
  };
  compact(effects.shards, tumble); compact(effects.casings, tumble);
  compact(effects.rings, r => { r.life -= w; r.radius += w*0.35; });
  compact(effects.flashes, f => { f.life -= w; });
  compact(effects.labels, l => { l.life -= dt; l.point[1] += dt*0.5; });
  compact(effects.indicators, i => { i.life -= dt; });
  // Air ripples trail visible bullets whenever time is bent.
  if (game.slow > 0.2 && !prefs.reduced) {
    for (const b of game.bullets) {
      // Your own rounds ripple only once they are clear of the crosshair.
      const spacing = b.owner === 'player' ? 2.4 : 0.9;
      b.ringAt ??= b.owner === 'player' ? 4 : 0.8;
      while (b.traveled >= b.ringAt && effects.rings.length < 160) {
        effects.rings.push({pos:b.start.map((v, i) => v + b.dir[i]*b.ringAt), dir:b.dir, radius:0.02, life:0.7, max:0.7, enemy:b.owner === 'enemy'});
        b.ringAt += spacing;
      }
      if (b.traveled >= b.ringAt) b.ringAt = b.traveled + spacing;
    }
  }
  effects.fovKick *= Math.exp(-6*dt); effects.shake = Math.max(0, effects.shake - dt*5);
  effects.wave = Math.max(0, effects.wave - dt*1.6); effects.denied = Math.max(0, effects.denied - dt);
  hitTime = Math.max(0, hitTime - dt); damageTime = Math.max(0, damageTime - dt);
  if (feed.some(f => f.until < performance.now()/1000)) { feed = feed.filter(f => f.until >= performance.now()/1000); renderFeed(); }
}
function updateHUD() {
  const w = game.weapon, s = game.stats, p = game.player, def = game.weaponDef, ammo = game.ammo[w.index];
  $('score').textContent = String(s.score).padStart(6, '0');
  $('wave').textContent = `WAVE ${String(Math.max(1, game.wave)).padStart(2, '0')}`;
  const hostiles = game.bots.length + game.queue.length;
  $('wave-label').textContent = game.breakTimer > 0 && game.wave > 0 ? `NEXT WAVE IN ${Math.ceil(game.breakTimer)}` : game.wave ? `HOSTILES ${hostiles}` : 'STAND BY';
  $('combo').textContent = game.combo > 1 ? `${Math.min(game.combo, 5)}× MULTIPLIER / ${game.combo} CHAIN` : 'CHAIN KILLS FOR A MULTIPLIER';
  $('ammo').textContent = String(ammo).padStart(2, '0'); $('ammo-max').textContent = ` / ${def.mag}`;
  $('weapon-name').textContent = `${def.name} / ${def.kind}`;
  for (let i = 0; i < WEAPONS.length; i++) $(`slot-${i}`).classList.toggle('active', i === w.index);
  $('weapon-status').textContent = w.reload > 0 ? `RELOADING ${Math.ceil((1 - w.reload/def.reload)*100)}%` : w.switching > 0 ? 'SWITCHING' : ammo === 0 ? (prefs.profile === 'xbox' ? 'X TO RELOAD' : 'R TO RELOAD') : 'READY';
  $('health-value').textContent = Math.ceil(p.health); $('health-bar').style.width = `${p.health}%`;
  $('health-bar').style.background = p.health < 35 ? '#ff6a3d' : '';
  $('focus-value').textContent = Math.floor(game.focus); $('focus-bar').style.width = `${game.focus}%`;
  const xbox = prefs.profile === 'xbox';
  $('status-text').textContent = p.invulnerable > 0 && game.mode === 'run' ? 'SPAWN PROTECTION'
    : p.prone > 0 ? 'ON YOUR BACK · KEEP SHOOTING'
    : game.focusOn ? (xbox ? 'BULLET TIME · LT TO RELEASE' : 'BULLET TIME · Q / RMB TO RELEASE')
    : xbox ? 'LT BULLET TIME · B SHOOTDODGE · Y WEAPON' : 'Q / RMB BULLET TIME · SHIFT DIVE · 1–6 GUNS';
}
function finish() {
  clearInput(); const s = game.stats, newRecord = s.score > best;
  if (newRecord) { best = s.score; storage.set('bullettime.best', best); } updateBest();
  $('final-score').textContent = s.score.toLocaleString(); $('record-label').textContent = newRecord ? 'NEW PERSONAL BEST' : 'FINAL SCORE';
  $('results-title').textContent = s.waves >= 8 ? 'A LEGEND IN SLOW MOTION.' : s.waves >= 4 ? 'THEY’LL TALK ABOUT THIS ONE.' : 'YOU WENT DOWN SWINGING.';
  const minutes = Math.floor(s.time/60), seconds = Math.floor(s.time%60);
  const rows = [['WAVES CLEARED', s.waves], ['KILLS', s.kills], ['ACCURACY', `${s.shots ? Math.round(s.hits/s.shots*100) : 0}%`], ['HEADSHOTS', s.heads], ['BULLET TIME KILLS', s.slowKills],
    ['MID-DIVE KILLS', s.airKills], ['BEST CHAIN', s.bestCombo], ['GLASS BROKEN', s.glass], ['SURVIVED', `${minutes}:${String(seconds).padStart(2, '0')}`]];
  $('results-grid').replaceChildren();
  for (const [label, value] of rows) { const cell = document.createElement('div'), b = document.createElement('b'), small = document.createElement('small'); b.textContent = value; small.textContent = label; cell.append(b, small); $('results-grid').append(cell); }
  $('rank').textContent = s.score >= 20000 ? 'S-RANK / TIME BENDS AROUND YOU.' : s.score >= 9000 ? 'A-RANK / POETRY IN SLOW MOTION.' : s.score >= 3500 ? 'B-RANK / THE SECOND IS YOURS.' : 'C-RANK / DIVE MORE. FEAR LESS.';
  sound.play('end'); setScreen('results'); if (document.pointerLockElement) document.exitPointerLock(); $('play-again').focus();
}

// ---- Overlay ----------------------------------------------------------------
function drawOverlay(time) {
  const width = overlay.clientWidth, height = overlay.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
  if (overlay.width !== Math.round(width*dpr) || overlay.height !== Math.round(height*dpr)) { overlay.width = Math.round(width*dpr); overlay.height = Math.round(height*dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  if (state === 'menu' || state === 'results') return;
  const x = width/2, y = height/2, slow = game.slow, cinematic = !!game.killcam;
  if (slow > 0.02) {
    // Bullet-time grade: warm vignette, radial time streaks.
    const g = ctx.createRadialGradient(x, y, Math.min(width, height)*0.25, x, y, Math.hypot(x, y));
    g.addColorStop(0, 'rgba(40,20,5,0)'); g.addColorStop(1, `rgba(30,12,2,${0.6*slow})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    if (!prefs.reduced) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(time*0.04); ctx.strokeStyle = `rgba(255,190,120,${0.05*slow})`; ctx.lineWidth = 1;
      const r0 = Math.min(width, height)*0.42, r1 = Math.hypot(x, y);
      ctx.beginPath(); for (let i = 0; i < 36; i++) { const a = i/36*Math.PI*2 + Math.sin(i*7.3)*0.05; ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0); ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1); } ctx.stroke();
      ctx.restore();
    }
  }
  if (effects.wave > 0 && !prefs.reduced) {
    const k = 1 - effects.wave, r = k*Math.hypot(x, y)*1.1;
    ctx.strokeStyle = `rgba(255,190,110,${effects.wave*0.55})`; ctx.lineWidth = 2 + effects.wave*10; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
  }
  if (cinematic) {
    const kc = game.killcam, bar = height*0.11*Math.min(1, kc.timer*4);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, bar); ctx.fillRect(0, height - bar, width, bar);
    ctx.fillStyle = 'rgba(242,166,74,0.9)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillText(kc.phase === 'flight' ? `FINAL ROUND · ${kc.distance.toFixed(1)} M` : 'WAVE CLEARED', 24, height - bar/2 + 4);
    ctx.textAlign = 'right'; ctx.fillText(`${(game.timeScale*100).toFixed(1)}% SPEED`, width - 24, height - bar/2 + 4);
    return;
  }
  if (game.dying > 0) { ctx.fillStyle = `rgba(80,0,0,${0.5*(1 - game.dying/1.7)})`; ctx.fillRect(0, 0, width, height); return; }
  // Crosshair grows with your current spread.
  const def = game.weaponDef, w = game.weapon, p = game.player;
  const spread = def.spread + (game.moving && !p.diving ? def.moveSpread : 0) + (!p.grounded && !p.diving ? 0.02 : 0) + w.bloom;
  const gap = 5 + spread*420 + (w.recoil + Math.max(w.recoilL, w.recoilR))*6;
  ctx.strokeStyle = slow > 0.5 ? '#ffd59a' : '#f0e8dc'; ctx.lineWidth = 1.5; ctx.globalAlpha = w.reload > 0 || w.switching > 0 ? 0.35 : 0.95;
  ctx.beginPath(); for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { ctx.moveTo(x + dx*gap, y + dy*gap); ctx.lineTo(x + dx*(gap + 7), y + dy*(gap + 7)); } ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1;
  if (hitTime > 0) {
    ctx.globalAlpha = Math.min(1, hitTime*8); ctx.strokeStyle = hitHead ? '#ffb36b' : hitKilled ? '#ff6a3d' : '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); for (const [dx, dy] of [[1,1],[-1,1],[1,-1],[-1,-1]]) { ctx.moveTo(x + dx*8, y + dy*8); ctx.lineTo(x + dx*15, y + dy*15); } ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.font = 'bold 17px monospace'; ctx.textAlign = 'center';
  for (const label of effects.labels) {
    const s = renderer.project(label.point);
    if (s) { ctx.globalAlpha = Math.min(1, label.life*2); ctx.fillStyle = '#ffd59a'; ctx.shadowBlur = 4; ctx.shadowColor = '#000'; ctx.fillText(label.text, s[0], s[1] - 30); }
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  for (const i of effects.indicators) {
    const angle = Math.atan2(i.x - p.x, -(i.z - p.z)) - p.yaw - Math.PI/2;
    ctx.strokeStyle = `rgba(255,80,40,${Math.min(1, i.life)*0.85})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x, y, 95, angle - 0.28, angle + 0.28); ctx.stroke();
  }
  if (damageTime > 0) {
    if (prefs.reduced) { ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 5; ctx.strokeRect(3, 3, width - 6, height - 6); }
    else { const g = ctx.createRadialGradient(x, y, height*0.25, x, y, width*0.7); g.addColorStop(0, 'rgba(160,30,10,0)'); g.addColorStop(1, `rgba(160,30,10,${damageTime*1.4})`); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); }
  }
  if (p.health < 30 && game.mode === 'run') { ctx.fillStyle = `rgba(120,10,0,${(30 - p.health)/30*0.25*(0.6 + 0.4*Math.sin(time*6))})`; ctx.fillRect(0, 0, width, height); }
  if (w.reload > 0) { const progress = 1 - w.reload/def.reload; ctx.fillStyle = '#ffffff40'; ctx.fillRect(x - 55, y + 46, 110, 2); ctx.fillStyle = '#f2a64a'; ctx.fillRect(x - 55, y + 46, 110*progress, 2); }
  if (effects.denied > 0) { ctx.fillStyle = `rgba(255,106,61,${effects.denied})`; ctx.font = 'bold 11px monospace'; ctx.fillText('HOURGLASS EMPTY', x, y + 66); }
}

// ---- Frame loop -------------------------------------------------------------
function frame(now) {
  const delta = Math.min(0.1, Math.max(0, (now - last)/1000)); last = now;
  pollController();
  if (state === 'playing' || state === 'menu') {
    const playing = state === 'playing';
    clock.advance(delta, dt => {
      if (playing && prefs.profile === 'xbox' && !game.killcam && game.dying <= 0) {
        const scale = 2.7*prefs.padSensitivity*dt, p = game.player;
        p.yaw += (pad.lookX || 0)*scale; p.pitch = clamp(p.pitch - (pad.lookY || 0)*scale*(prefs.invert ? -1 : 1), -1.45, 1.45);
      }
      game.step(dt, playing ? input() : {});
      updateEffects(dt);
      if (playing) consumeEvents(); else game.drainEvents();
      return state === 'playing' || state === 'menu';
    });
    if (playing) {
      hudElapsed += delta; if (hudElapsed >= 0.05) { updateHUD(); hudElapsed = 0; }
      document.body.classList.toggle('slow', game.slow > 0.5);
      sound.setSlow(game.killcam ? 1 : game.slow);
      if (game.slow > 0.6 && !game.killcam) { heartTimer -= delta; if (heartTimer <= 0) { sound.play('heart'); heartTimer = 1.05; } } else heartTimer = 0.25;
    }
  }
  sound.music(state === 'playing', Math.min(3, game.combo + (game.wave >= 4 ? 1 : 0)));
  if (renderer && !graphicsLost) {
    const draw = () => { renderer.render(game, effects, {menu:state === 'menu', time:now/1000, quality:prefs.lowQuality ? 0 : 1, reduced:prefs.reduced}); drawOverlay(now/1000); };
    if (state === 'playing' || state === 'menu') { frameGate.invalidate(); draw(); }
    else {
      // Everything that can change a frozen frame: screen, simulation tick and view size.
      const dpr = devicePixelRatio || 1, width = Math.max(1, Math.round(canvas.clientWidth*dpr)), height = Math.max(1, Math.round(canvas.clientHeight*dpr));
      frameGate.present({key:`${state}|${clock.ticks}|${dpr}`, width, height, contextEpoch}, draw);
    }
  }
  requestAnimationFrame(frame);
}
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); graphicsLost = true; pauseGame(); $('lock-message').textContent = 'Graphics context lost. Reload this page to restore the renderer.'; $('resume').disabled = true; });
canvas.addEventListener('webglcontextrestored', () => {
  try { renderer = new Renderer(canvas, game.world); renderer.setSkins(prefs.skins); graphicsLost = false; contextEpoch++; frameGate.invalidate(); $('resume').disabled = false; $('lock-message').textContent = 'Graphics restored. Resume when ready.'; }
  catch (error) { $('lock-message').textContent = error.message; }
});
async function offline() {
  if (!('serviceWorker' in navigator) || !isSecureContext) { $('offline-status').textContent = 'LOCAL SERVER / ONLINE PLAY'; return; }
  try {
    await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready;
    const registration = await navigator.serviceWorker.getRegistration();
    $('offline-status').textContent = '● OFFLINE READY';
    registration?.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) $('offline-status').textContent = 'UPDATE READY · CLOSE ALL GAME TABS TO APPLY'; });
    });
  } catch { $('offline-status').textContent = 'ONLINE PLAY / OFFLINE CACHE UNAVAILABLE'; }
}
syncPrefs(); updateBest();
try { renderer = new Renderer(canvas, game.world); renderer.setSkins(prefs.skins); last = performance.now(); requestAnimationFrame(frame); }
catch (error) { showError(error.message); $('start').disabled = true; }
$('start').focus();
offline();
// Test hook for automated browser checks only (no gameplay effect).
if (new URLSearchParams(location.search).has('test')) globalThis.__bulletTime = {get game() { return game; }, get state() { return state; }, effects, beginPlaying, startRun, frameStats:() => frameGate.stats()};
