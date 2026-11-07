import {clamp, mix, forward, seededRandom, boxAt, rayBox, segmentDistance} from './math.js';
import {makeWorld} from './world.js';
import {Navigation} from './navigation.js';

// Pure, fixed-step simulation. step(dt) always receives REAL time; bullet time
// is applied here by splitting it into three clocks:
//   world  - enemies, every bullet, corpses and debris (slowest)
//   player - the player's movement and dives (half speed)
//   weapon - your weapon cycling (barely slowed: the edge bullet time gives you)
// Mouse look stays in real time, so aiming is never slowed down.
export const RULES = Object.freeze({
  slowScale:0.22, playerSlow:0.5, weaponSlow:0.8, ramp:11,
  focusMax:100, focusStart:70, focusDrain:10.5, focusMin:8, focusRegenCap:30, focusRegen:2.5, focusKill:18, focusHead:7,
  diveSpeed:7.4, diveLift:4.8, diveGravity:13, proneTime:0.55, diveCooldown:0.2,
  gravity:20, jump:7, walk:5.6, crouchWalk:2.6, health:100, regenDelay:4.5, regenRate:7,
  playerBullet:150, enemyBullet:30, bulletRange:140,
  comboWindow:3.2, waveBreak:4.5, firstWave:1.6, maxCorpses:16,
  killcamFlight:1.5, killcamHold:1.9, killcamDeath:1.7
});

export const WEAPONS = Object.freeze([
  {id:'duals', name:'TWIN .45', kind:'DUAL PISTOLS', mag:24, reload:1.6, cycle:0.11, auto:false, pellets:1, spread:0.006, moveSpread:0.012, bloom:0, impulse:3.4,
    damage:{head:130, body:52, legs:36, limb:32}},
  {id:'shotgun', name:'BREACHER 12', kind:'PUMP SHOTGUN', mag:7, reload:2.2, cycle:0.72, auto:false, pellets:9, spread:0.06, moveSpread:0.008, bloom:0, impulse:7.5,
    damage:{head:36, body:26, legs:18, limb:16}},
  {id:'carbine', name:'VECTOR CARBINE', kind:'AUTO CARBINE', mag:32, reload:1.9, cycle:0.085, auto:true, pellets:1, spread:0.005, moveSpread:0.016, bloom:0.0035, impulse:4,
    damage:{head:100, body:34, legs:24, limb:20}}
]);

export const ENEMIES = Object.freeze({
  grunt:{hp:100, speed:2.0, scale:1, burst:3, interval:0.14, windup:0.55, wait:[1.6,2.7], spread:0.035, damage:8, pellets:1, range:34, near:9, far:21, points:100},
  runner:{hp:70, speed:3.4, scale:0.93, burst:5, interval:0.1, windup:0.45, wait:[1.9,3.0], spread:0.06, damage:6, pellets:1, range:28, near:6, far:14, points:120},
  heavy:{hp:240, speed:1.45, scale:1.18, burst:2, interval:0.5, windup:0.7, wait:[2.3,3.2], spread:0.09, damage:7, pellets:6, range:24, near:5, far:10, points:200}
});

export function hitboxes(bot) {
  const s = bot.scale || 1, y = bot.y;
  return [
    {part:'head', ...boxAt(bot.x, y+1.93*s, bot.z, 0.52*s, 0.5*s, 0.52*s)},
    {part:'body', ...boxAt(bot.x, y+1.19*s, bot.z, 0.78*s, 0.98*s, 0.54*s)},
    {part:'legs', ...boxAt(bot.x, y+0.36*s, bot.z, 0.66*s, 0.72*s, 0.46*s)},
    {part:'limb', ...boxAt(bot.x-0.5*s, y+1.17*s, bot.z, 0.24*s, 0.72*s, 0.36*s)},
    {part:'limb', ...boxAt(bot.x+0.5*s, y+1.17*s, bot.z-0.18*s, 0.24*s, 0.72*s, 0.36*s)}
  ];
}

// Nearest wall or bot along a ray. Hitboxes rotate with the bot.
export function traceShot(origin, direction, solids, bots, max = RULES.bulletRange) {
  let result = {distance:max, kind:'miss'};
  for (const box of solids) {
    const d = rayBox(origin, direction, box, max);
    if (d !== null && d <= result.distance) result = {distance:d, kind:'wall'};
  }
  for (const bot of bots) if (bot.alive) {
    const angle = bot.yaw || 0, cs = Math.cos(angle), sn = Math.sin(angle), dx = origin[0]-bot.x, dz = origin[2]-bot.z;
    const localOrigin = [bot.x+dx*cs-dz*sn, origin[1], bot.z+dx*sn+dz*cs];
    const localDirection = [direction[0]*cs-direction[2]*sn, direction[1], direction[0]*sn+direction[2]*cs];
    for (const box of hitboxes(bot)) {
      const d = rayBox(localOrigin, localDirection, box, result.distance);
      if (d !== null && d < result.distance) result = {distance:d, kind:'bot', bot, part:box.part};
    }
  }
  return {...result, point:origin.map((v,i) => v + direction[i]*result.distance)};
}

const occupied = (x, z, feet, height, r, b) =>
  feet+height > b.min[1]+0.001 && feet < b.max[1]-0.001 && x+r > b.min[0] && x-r < b.max[0] && z+r > b.min[2] && z-r < b.max[2];
// Substeps prevent tunnelling; axis separation allows sliding along cover.
export function moveBody(body, dx, dz, solids, r = 0.3, height = 1.75, onContact = null) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  // A contact handler can remove a breakable obstacle before this substep.
  const blockedAt = (x, z) => solids.some(b => occupied(x, z, body.y, height, r, b) && !onContact?.(b));
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    const x = body.x + dx/steps, z = body.z + dz/steps;
    if (!blockedAt(x, body.z)) body.x = x; else blocked = true;
    if (!blockedAt(body.x, z)) body.z = z; else blocked = true;
  }
  return blocked;
}
function gaussian(random) { return (random() + random() + random() - 1.5) / 1.5; }

export class Game {
  constructor(mode = 'run', seed = 9, options = {}) {
    this.mode = mode; this.random = seededRandom(seed); this.world = makeWorld();
    this.options = {killcam: options.killcam !== false};
    this.glass = this.world.glass.map((g, id) => ({...g, id, intact:true}));
    this.refreshBlockers();
    this.navigation = new Navigation(this.world.solids, this.world.bounds);
    this.time = 0; this.realTime = 0; this.timeScale = 1; this.slow = 0;
    this.focus = RULES.focusStart; this.focusOn = false;
    this.finished = false; this.events = []; this.dying = 0; this.moving = false;
    const [sx, sz] = this.world.start;
    this.player = {x:sx, y:0, z:sz, yaw:0, pitch:0, vy:0, grounded:true, crouch:false, health:RULES.health, invulnerable:1.5,
      diving:false, diveX:0, diveZ:0, diveSide:0, prone:0, diveCooldown:0, eye:1.68, roll:0};
    this.ammo = WEAPONS.map(w => w.mag);
    this.weapon = {index:0, cooldown:0, reload:0, switching:0, recoil:0, recoilL:0, recoilR:0, hand:-1, bloom:0, queued:0};
    this.stats = {score:0, kills:0, shots:0, hits:0, heads:0, slowKills:0, airKills:0, longKills:0, glass:0, bestCombo:0, waves:0, time:0, focusTime:0, dives:0};
    this.combo = 0; this.lastKill = -10; this.lastDamage = -10;
    this.bots = []; this.corpses = []; this.bullets = []; this.nextId = 1;
    this.wave = 0; this.queue = []; this.spawnTimer = 0; this.breakTimer = RULES.firstWave;
    this.killcam = null;
  }
  emit(type, data = {}) { this.events.push({...data, type}); }
  drainEvents() { return this.events.splice(0); }
  refreshBlockers() { this.blockers = this.world.solids.concat(this.glass.filter(g => g.intact)); }
  get weaponDef() { return WEAPONS[this.weapon.index]; }
  playerHeight() { const p = this.player; return p.diving || p.prone > 0 ? 0.8 : p.crouch ? 1.12 : 1.75; }
  eyePosition() { const p = this.player; return [p.x, p.y + p.eye, p.z]; }
  get busy() { return this.finished || this.dying > 0 || !!this.killcam; }

  // ---- Bullet time -------------------------------------------------------
  toggleFocus() {
    if (this.busy) return false;
    if (this.focusOn) { this.focusOn = false; this.emit('focusOff', {empty:false}); return true; }
    if (this.focus < RULES.focusMin) { this.emit('focusDenied'); return false; }
    this.focusOn = true; this.emit('focusOn'); return true;
  }
  setFocus(active) { if (!!active !== this.focusOn) this.toggleFocus(); }

  // ---- Weapons -----------------------------------------------------------
  switchWeapon(index) {
    const w = this.weapon;
    if (this.busy || index === w.index || index < 0 || index >= WEAPONS.length) return false;
    Object.assign(w, {index, switching:0.3, reload:0, queued:0, cooldown:0, bloom:0});
    this.emit('switch', {weapon:WEAPONS[index].id}); return true;
  }
  cycleWeapon(direction = 1) { return this.switchWeapon((this.weapon.index + direction + WEAPONS.length) % WEAPONS.length); }
  reload() {
    const w = this.weapon, def = this.weaponDef;
    if (this.busy || w.reload > 0 || w.switching > 0 || this.ammo[w.index] === def.mag) return false;
    w.reload = def.reload; w.queued = 0; this.emit('reload', {weapon:def.id}); return true;
  }
  cancelShot() { this.weapon.queued = 0; }
  // A trigger press. Semi-automatic weapons buffer a press for a short window.
  requestShot() {
    if (this.busy) return null;
    this.weapon.queued = 0.16;
    return this.tryFire();
  }
  tryFire() {
    const w = this.weapon;
    if (this.busy || w.reload > 0 || w.switching > 0 || w.cooldown > 0) return null;
    if (this.ammo[w.index] === 0) { w.queued = 0; this.reload(); return null; }
    return this.fire();
  }
  fire() {
    const p = this.player, w = this.weapon, def = this.weaponDef;
    this.ammo[w.index]--; w.cooldown = def.cycle; w.queued = 0; this.stats.shots++;
    const origin = this.eyePosition();
    let hand = 1;
    if (def.id === 'duals') { w.hand = -w.hand; hand = w.hand; if (hand > 0) w.recoilR = 1; else w.recoilL = 1; } else w.recoil = 1;
    const spread = def.spread + (this.moving && !p.diving ? def.moveSpread : 0) + (!p.grounded && !p.diving ? 0.02 : 0) + w.bloom;
    w.bloom = Math.min(0.03, w.bloom + def.bloom);
    const record = {hit:false};
    const slowShot = this.slow > 0.5, midair = p.diving;
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    // Bullets travel from the eye (so they land on the crosshair); the visual
    // offset makes their trails appear to leave the muzzle and converge.
    const offset = [cs*0.2*hand, -0.14, sn*0.2*hand];
    const fired = [];
    for (let i = 0; i < def.pellets; i++) {
      const dir = forward(p.yaw + gaussian(this.random)*spread, p.pitch + gaussian(this.random)*spread);
      const bullet = {id:this.nextId++, owner:'player', pos:origin.slice(), start:origin.slice(), dir, speed:RULES.playerBullet, traveled:0, max:RULES.bulletRange,
        damage:def.damage, impulse:def.impulse, weapon:def.id, slowShot, midair, offset, record};
      this.bullets.push(bullet); fired.push(bullet);
    }
    this.emit('shot', {weapon:def.id, hand, origin, slowShot, yaw:p.yaw, pitch:p.pitch});
    if (this.options.killcam && !this.killcam && this.isFinalTarget()) this.predictKillcam(fired, def);
    return fired;
  }
  isFinalTarget() {
    return this.mode === 'run' && this.queue.length === 0 && this.bots.filter(b => b.alive).length === 1;
  }
  // If this trigger pull will finish the wave, follow the bullet in.
  predictKillcam(fired, def) {
    let total = 0, first = null, target = null;
    for (const bullet of fired) {
      const t = traceShot(bullet.pos, bullet.dir, this.world.solids, this.bots, bullet.max);
      if (t.kind !== 'bot') continue;
      total += def.damage[t.part]; target = t.bot;
      if (!first || t.distance < first.distance) first = {bullet, distance:t.distance};
    }
    if (!first || total < target.hp) return;
    const scale = clamp(first.distance / (RULES.playerBullet * RULES.killcamFlight), 0.012, 0.2);
    this.killcam = {bullet:first.bullet, record:first.bullet.record, target, phase:'flight', timer:0, scale, corpse:null, distance:first.distance};
    this.weapon.queued = 0;
    this.emit('killcamStart', {distance:first.distance});
  }
  endKillcam() {
    if (!this.killcam) return;
    this.killcam = null; this.player.invulnerable = Math.max(this.player.invulnerable, 0.6);
    this.emit('killcamEnd');
  }

  // ---- Movement ----------------------------------------------------------
  tryDive(input) {
    const p = this.player;
    if (this.busy || !p.grounded || p.diving || p.prone > 0 || p.diveCooldown > 0) return false;
    let dx = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : Number(!!input.right) - Number(!!input.left);
    let dz = Number.isFinite(input.moveZ) ? clamp(input.moveZ, -1, 1) : Number(!!input.forward) - Number(!!input.back);
    if (Math.hypot(dx, dz) < 0.2) { dx = 0; dz = -1; } // No direction: dive backwards, away from danger.
    const len = Math.hypot(dx, dz); dx /= len; dz /= len;
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    Object.assign(p, {diving:true, diveX:cs*dx + sn*dz, diveZ:sn*dx - cs*dz, diveSide:dx, vy:RULES.diveLift, grounded:false, crouch:false});
    this.stats.dives++; this.emit('dive', {side:dx}); return true;
  }
  updatePlayer(dt, pdt, input) {
    const p = this.player;
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.diveCooldown = Math.max(0, p.diveCooldown - pdt);
    if (this.realTime - this.lastDamage > RULES.regenDelay && this.mode === 'run') p.health = Math.min(RULES.health, p.health + RULES.regenRate*dt);
    if (input.dive) this.tryDive(input);
    const wantCrouch = !!input.crouch && !p.diving && p.prone <= 0;
    if (wantCrouch || !this.blockers.some(b => occupied(p.x, p.z, p.y, 1.75, 0.3, b))) p.crouch = wantCrouch;
    let dx = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : Number(!!input.right) - Number(!!input.left);
    let dz = Number.isFinite(input.moveZ) ? clamp(input.moveZ, -1, 1) : Number(!!input.forward) - Number(!!input.back);
    const length = Math.max(1, Math.hypot(dx, dz)); dx /= length; dz /= length;
    this.moving = false;
    if (p.diving) moveBody(p, p.diveX*RULES.diveSpeed*pdt, p.diveZ*RULES.diveSpeed*pdt, this.blockers, 0.3, 0.8, box => {
      if (box.intact === undefined) return false;
      this.shatter(box, [p.x, p.y+0.4, p.z], [p.diveX, 0, p.diveZ]);
      return true;
    });
    else if (p.prone > 0) {
      p.prone = Math.max(0, p.prone - pdt);
      if (p.prone === 0) { p.diveCooldown = RULES.diveCooldown; this.emit('getUp'); }
    } else {
      const speed = p.crouch ? RULES.crouchWalk : RULES.walk;
      this.moving = Math.hypot(dx, dz) > 0.05;
      const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      moveBody(p, (cs*dx + sn*dz)*speed*pdt, (sn*dx - cs*dz)*speed*pdt, this.blockers, 0.3, this.playerHeight());
      if (input.jump && p.grounded && !p.crouch) { p.vy = RULES.jump; p.grounded = false; }
    }
    const height = this.playerHeight(), oldY = p.y;
    p.vy -= (p.diving ? RULES.diveGravity : RULES.gravity) * pdt; p.y += p.vy * pdt;
    const wasAirborne = !p.grounded; p.grounded = false;
    let floor = 0;
    for (const b of this.blockers) if (p.x+0.28 > b.min[0] && p.x-0.28 < b.max[0] && p.z+0.28 > b.min[2] && p.z-0.28 < b.max[2]) {
      if (oldY >= b.max[1]-0.01 && p.y <= b.max[1] && p.vy <= 0) floor = Math.max(floor, b.max[1]);
      if (p.vy > 0 && oldY+height <= b.min[1] && p.y+height > b.min[1]) { p.y = b.min[1]-height; p.vy = 0; }
    }
    if (p.y <= floor) {
      p.y = floor; p.vy = 0; p.grounded = true;
      if (wasAirborne && p.diving) { p.diving = false; p.prone = RULES.proneTime; this.emit('land', {dive:true}); }
    }
    const eye = p.diving ? 0.85 : p.prone > 0 ? 0.5 : p.crouch ? 1.08 : 1.68;
    p.eye += (eye - p.eye) * Math.min(1, pdt * (p.diving ? 12 : 8));
    const roll = p.diving ? -p.diveSide*0.3 : p.prone > 0 ? -p.diveSide*0.18 : 0;
    p.roll += (roll - p.roll) * Math.min(1, dt * 7);
  }
  updateWeapon(gdt, input) {
    const w = this.weapon, def = this.weaponDef;
    w.cooldown = Math.max(0, w.cooldown - gdt); w.switching = Math.max(0, w.switching - gdt);
    w.recoil = Math.max(0, w.recoil - gdt*7); w.recoilL = Math.max(0, w.recoilL - gdt*9); w.recoilR = Math.max(0, w.recoilR - gdt*9);
    if (!input.fire) w.bloom = Math.max(0, w.bloom - gdt*0.08);
    if (w.reload > 0) {
      w.reload = Math.max(0, w.reload - gdt);
      if (w.reload === 0) { this.ammo[w.index] = def.mag; this.emit('loaded', {weapon:def.id}); }
    }
    if (input.fire && def.auto) this.tryFire();
    else if (w.queued > 0 && !this.tryFire()) w.queued = Math.max(0, w.queued - gdt);
  }

  // ---- Damage ------------------------------------------------------------
  damage(amount, from) {
    const p = this.player;
    if (this.mode !== 'run' || p.invulnerable > 0 || this.busy) return false;
    p.health = Math.max(0, p.health - amount); this.lastDamage = this.realTime;
    this.emit('damage', {amount, from});
    if (p.health === 0) {
      this.dying = RULES.killcamDeath; this.focusOn = false; this.combo = 0;
      this.emit('death');
    }
    return true;
  }
  shatter(g, point, dir) {
    if (!g.intact) return;
    g.intact = false; this.refreshBlockers(); this.stats.glass++;
    this.emit('glass', {pane:g, point, dir});
  }
  hitBot(bullet, t) {
    const bot = t.bot, amount = bullet.damage[t.part];
    bot.hp -= amount; bot.flash = 0.12; bot.evade = 0.55; bot.strafe = -(bot.strafe || 1);
    if (bot.type !== 'heavy') { bot.charge = 0; bot.burst = 0; bot.wait = Math.max(bot.wait, 0.4); }
    if (!bullet.record.hit) { bullet.record.hit = true; this.stats.hits++; }
    const killed = bot.hp <= 0;
    this.emit('hit', {point:t.point, head:t.part === 'head', killed, dir:bullet.dir});
    if (killed) this.killBot(bot, bullet, t);
  }
  killBot(bot, bullet, t) {
    bot.alive = false;
    const def = ENEMIES[bot.type], head = t.part === 'head', slow = !!bullet.slowShot, air = !!bullet.midair;
    const range = Math.hypot(bot.x - bullet.start[0], bot.z - bullet.start[2]), long = range > 24;
    this.combo = this.realTime - this.lastKill <= RULES.comboWindow ? this.combo + 1 : 1; this.lastKill = this.realTime;
    const multiplier = Math.min(5, this.combo);
    const points = (def.points + (head ? 50 : 0) + (slow ? 50 : 0) + (air ? 100 : 0) + (long ? 50 : 0)) * multiplier;
    const s = this.stats;
    s.kills++; s.score += points; s.heads += Number(head); s.slowKills += Number(slow); s.airKills += Number(air); s.longKills += Number(long);
    s.bestCombo = Math.max(s.bestCombo, this.combo);
    this.focus = Math.min(RULES.focusMax, this.focus + RULES.focusKill + (head ? RULES.focusHead : 0));
    const push = bullet.impulse * (head ? 1.15 : 1);
    const corpse = {id:bot.id, type:bot.type, scale:bot.scale, x:bot.x, y:bot.y, z:bot.z, yaw:bot.yaw, tilt:0, lean:0,
      vx:bullet.dir[0]*push, vz:bullet.dir[2]*push, vy:1.4 + (head ? 1.2 : 0) + bullet.impulse*0.12,
      tiltVel:2.6 + push*0.35, leanVel:(this.random()-0.5)*1.6, life:10, grounded:false, phase:bot.phase, head};
    this.corpses.push(corpse);
    if (this.corpses.length > RULES.maxCorpses) this.corpses.shift();
    this.emit('kill', {points, head, slow, air, long, combo:this.combo, point:t.point, position:[bot.x, bot.y, bot.z], type:bot.type, dir:bullet.dir});
    const kc = this.killcam;
    if (kc && kc.phase === 'flight' && kc.target === bot && kc.record === bullet.record) {
      kc.bullet = bullet; kc.phase = 'impact'; kc.timer = 0; kc.scale = 0.1; kc.corpse = corpse; this.emit('killcamImpact');
    }
  }

  // ---- Bullets -----------------------------------------------------------
  moveBullet(b, wdt) {
    const travel = b.speed * wdt;
    if (travel <= 0) return true;
    const max = Math.min(travel, b.max - b.traveled);
    let wall = Infinity;
    for (const s of this.world.solids) { const d = rayBox(b.pos, b.dir, s, max); if (d !== null && d < wall) wall = d; }
    const reach = Math.min(max, wall);
    for (const g of this.glass) if (g.intact) {
      const d = rayBox(b.pos, b.dir, g, reach);
      if (d !== null) this.shatter(g, b.pos.map((v,i) => v + b.dir[i]*d), b.dir);
    }
    if (b.owner === 'player') {
      const t = traceShot(b.pos, b.dir, [], this.bots, reach);
      if (t.kind === 'bot') { b.pos = t.point; b.traveled += t.distance; this.hitBot(b, t); return false; }
    } else {
      const p = this.player;
      if (!(p.invulnerable > 0) && !this.busy && this.mode === 'run') {
        const h = this.playerHeight(), box = boxAt(p.x, p.y + h/2, p.z, 0.72, h, 0.72);
        const d = rayBox(b.pos, b.dir, box, reach);
        if (d !== null) { b.pos = b.pos.map((v,i) => v + b.dir[i]*d); this.damage(b.damage, b.from); return false; }
      }
      if (!b.whiz && segmentDistance(b.pos, b.dir, reach, this.eyePosition()) < 1.6) { b.whiz = true; this.emit('whiz', {point:b.pos.slice()}); }
    }
    if (wall <= max) {
      b.pos = b.pos.map((v,i) => v + b.dir[i]*wall); b.traveled += wall;
      this.emit('impact', {point:b.pos.slice(), dir:b.dir, owner:b.owner}); return false;
    }
    for (let i = 0; i < 3; i++) b.pos[i] += b.dir[i]*max;
    b.traveled += max;
    return b.traveled < b.max - 1e-6;
  }
  updateBullets(wdt) {
    let write = 0;
    for (const b of this.bullets) {
      const alive = this.moveBullet(b, wdt);
      if (alive) this.bullets[write++] = b;
    }
    this.bullets.length = write;
    // A shotgun's first impact may only wound. Keep following the same blast
    // until one of its pellets kills the target or all of them have stopped.
    const kc = this.killcam;
    if (kc?.phase === 'flight' && !this.bullets.includes(kc.bullet)) {
      const next = this.bullets.find(b => b.record === kc.record);
      if (next) kc.bullet = next;
      else this.endKillcam();
    }
  }

  // ---- Enemies -----------------------------------------------------------
  maxAlive() { return Math.min(3 + this.wave, 7); }
  startWave() {
    this.wave++;
    const n = this.wave, count = Math.min(3 + n*2, 23);
    this.queue = [];
    for (let i = 0; i < count; i++) this.queue.push(n >= 3 && i % 5 === 4 ? 'heavy' : n >= 2 && i % 3 === 2 ? 'runner' : 'grunt');
    for (let i = this.queue.length - 1; i > 0; i--) { const j = Math.floor(this.random()*(i+1)); [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; }
    this.spawnTimer = 0;
    this.emit('wave', {wave:n, count});
  }
  spawnBot(type) {
    const def = ENEMIES[type], p = this.player, spots = this.world.spawns;
    let best = null, score = -Infinity;
    for (const s of spots) {
      const distance = Math.hypot(s[0]-p.x, s[1]-p.z);
      if (this.bots.some(b => b.alive && Math.hypot(b.x-s[0], b.z-s[1]) < 2)) continue;
      const hidden = this.lineBlocked([s[0], 1.6, s[1]], this.eyePosition());
      const value = Math.min(distance, 30) + (hidden ? 12 : 0) + this.random()*6 - (distance < 12 ? 40 : 0);
      if (value > score) { score = value; best = s; }
    }
    best ??= spots[Math.floor(this.random()*spots.length)];
    const bot = {id:this.nextId++, type, scale:def.scale, x:best[0], y:0, z:best[1], yaw:0, hp:def.hp, maxHp:def.hp, alive:true,
      phase:this.random()*Math.PI*2, think:0, visible:false, moveX:0, moveZ:0, strafe:this.random() < 0.5 ? -1 : 1, turn:1+this.random()*2,
      evade:0, wait:1+this.random()*1.6, charge:0, burst:0, burstTimer:0, flash:0, spawnFx:0.6};
    bot.yaw = Math.atan2(-(p.x-bot.x), -(p.z-bot.z));
    this.bots.push(bot);
    this.emit('spawn', {position:[bot.x, 0, bot.z], type});
    return bot;
  }
  lineBlocked(a, b) {
    const delta = b.map((v,i) => v - a[i]), distance = Math.hypot(...delta) || 1, dir = delta.map(v => v/distance);
    return this.world.solids.some(box => rayBox(a, dir, box, distance) !== null);
  }
  botMuzzle(b) {
    const s = b.scale || 1, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    return [b.x + 0.5*s*cs - 0.95*s*sn, b.y + 1.14*s, b.z - 0.5*s*sn - 0.95*s*cs];
  }
  botSight(b) {
    const p = this.player, origin = this.botMuzzle(b), h = this.playerHeight();
    const point = [p.x, p.y + h*0.62, p.z], delta = point.map((v,i) => v - origin[i]);
    const distance = Math.hypot(...delta);
    return {origin, point, distance, visible:distance < ENEMIES[b.type].range && !this.lineBlocked(origin, point)};
  }
  fireEnemy(b) {
    const def = ENEMIES[b.type], sight = this.botSight(b);
    if (!sight.visible) return false;
    const p = this.player, error = def.spread + (p.diving ? 0.07 : 0) + (this.moving ? 0.022 : 0) + (p.prone > 0 ? 0.02 : 0);
    const delta = sight.point.map((v,i) => v - sight.origin[i]), d = sight.distance || 1;
    const yaw = Math.atan2(delta[0], -delta[2]), pitch = Math.asin(clamp(delta[1]/d, -1, 1));
    for (let i = 0; i < def.pellets; i++) {
      const dir = forward(yaw + gaussian(this.random)*error, pitch + gaussian(this.random)*error*0.6);
      this.bullets.push({id:this.nextId++, owner:'enemy', pos:sight.origin.slice(), start:sight.origin.slice(), dir, speed:RULES.enemyBullet*(b.type === 'heavy' ? 0.9 : 1),
        traveled:0, max:60, damage:def.damage, from:[b.x, b.y + 1.2, b.z], type:b.type});
    }
    this.emit('enemyShot', {origin:sight.origin, type:b.type});
    return true;
  }
  moveBot(b, dx, dz, height) {
    for (const g of this.glass) if (g.intact && occupied(b.x + dx*8, b.z + dz*8, b.y, height, 0.45, g)) this.shatter(g, [b.x, 1.2, b.z], [Math.sign(dx)||0, 0, Math.sign(dz)||0]);
    moveBody(b, dx, dz, this.blockers, 0.42, height);
  }
  updateBot(b, wdt) {
    const p = this.player, def = ENEMIES[b.type], s = b.scale || 1;
    b.flash = Math.max(0, b.flash - wdt); b.spawnFx = Math.max(0, b.spawnFx - wdt);
    b.phase += wdt * (b.type === 'runner' ? 1.3 : 0.9);
    b.evade = Math.max(0, b.evade - wdt); b.turn -= wdt;
    if (b.turn <= 0) { b.strafe = -b.strafe; b.turn = 1.2 + this.random()*2; }
    b.think -= wdt;
    if (b.think <= 0) {
      b.think = 0.2; // Tactical decisions at 5 Hz of world time; motion at the full tick rate.
      b.visible = this.botSight(b).visible;
      let dx, dz;
      if (!b.visible) {
        const goal = this.navigation.toward(b.x, b.z, p.x, p.z); dx = goal[0]-b.x; dz = goal[1]-b.z;
      } else {
        const x = p.x-b.x, z = p.z-b.z, d = Math.hypot(x, z) || 1;
        const approach = d < def.near ? -1 : d > def.far ? 0.85 : 0, strafe = b.strafe * (b.type === 'runner' ? 1.2 : b.type === 'heavy' ? 0.35 : 0.7);
        dx = x/d*approach + z/d*strafe; dz = z/d*approach - x/d*strafe;
      }
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      b.moveX = 0; b.moveZ = 0;
      for (const angle of [0, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2]) {
        const cs = Math.cos(angle), sn = Math.sin(angle), x = dx*cs - dz*sn, z = dx*sn + dz*cs;
        if (!this.world.solids.some(box => occupied(b.x + x*0.75, b.z + z*0.75, b.y, 2.2*s, 0.42, box))) { b.moveX = x; b.moveZ = z; break; }
      }
    }
    const speed = (b.evade > 0 ? def.speed*1.6 : def.speed) * (b.charge > 0 || b.burst > 0 ? 0.25 : 1);
    this.moveBot(b, b.moveX*speed*wdt, b.moveZ*speed*wdt, 2.2*s);
    b.yaw = Math.atan2(-(p.x-b.x), -(p.z-b.z));
    if (this.mode !== 'run' || this.busy) { b.charge = 0; b.burst = 0; return; }
    if (b.burst > 0) {
      b.burstTimer -= wdt;
      if (b.burstTimer <= 0) {
        this.fireEnemy(b); b.burst--; b.burstTimer = def.interval;
        if (b.burst === 0) b.wait = def.wait[0] + this.random()*(def.wait[1]-def.wait[0]);
      }
      return;
    }
    if (!b.visible || p.invulnerable > 0) { b.charge = 0; b.wait = Math.max(b.wait, 0.4); return; }
    b.wait -= wdt;
    if (b.wait <= 0) {
      b.charge += wdt;
      if (b.charge >= def.windup) {
        b.charge = 0;
        // Recheck the real muzzle line before committing; never fire through cover.
        if (this.botSight(b).visible) { b.burst = def.burst; b.burstTimer = 0; }
        else b.wait = 0.5;
      }
    }
  }
  updateCorpses(wdt) {
    let write = 0;
    for (const c of this.corpses) {
      c.life -= wdt;
      if (!c.grounded) c.vy -= 15*wdt;
      const blocked = moveBody(c, c.vx*wdt, c.vz*wdt, this.world.solids, 0.3, 0.5);
      if (blocked) { c.vx *= 0.3; c.vz *= 0.3; }
      c.y += c.vy*wdt;
      if (c.y <= 0) { c.y = 0; c.vy = 0; c.grounded = true; }
      if (c.grounded) { const f = Math.exp(-5*wdt); c.vx *= f; c.vz *= f; }
      c.tilt = Math.min(1.5, c.tilt + c.tiltVel*wdt);
      c.lean = clamp(c.lean + c.leanVel*wdt, -0.6, 0.6);
      if (c.life > 0) this.corpses[write++] = c;
    }
    this.corpses.length = write;
  }
  updateWaves(dt, wdt) {
    if (this.killcam) return;
    if (this.breakTimer > 0) { this.breakTimer -= dt; if (this.breakTimer <= 0) { this.breakTimer = 0; this.startWave(); } return; }
    const alive = this.bots.length;
    if (this.queue.length && alive < this.maxAlive()) {
      this.spawnTimer -= wdt;
      if (this.spawnTimer <= 0) { this.spawnBot(this.queue.shift()); this.spawnTimer = 0.9; }
    }
    if (!this.queue.length && !alive && this.wave > 0) {
      const bonus = 250 * this.wave;
      this.stats.score += bonus; this.stats.waves = this.wave;
      this.player.health = Math.min(RULES.health, this.player.health + 30);
      this.focus = Math.min(RULES.focusMax, this.focus + 25);
      this.breakTimer = RULES.waveBreak;
      this.emit('waveClear', {wave:this.wave, bonus});
    }
  }

  // ---- Tick --------------------------------------------------------------
  step(dt, input = {}) {
    if (this.finished || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1/30); this.realTime += dt;
    const p = this.player;
    if (this.killcam) {
      const kc = this.killcam; kc.timer += dt; input = {};
      if ((kc.phase === 'impact' && kc.timer >= RULES.killcamHold) || kc.timer > 8) this.endKillcam();
    }
    if (this.dying > 0) { input = {}; }
    let target = 1;
    if (this.killcam) target = this.killcam.scale;
    else if (this.dying > 0) target = 0.15;
    else if (this.focusOn || p.diving) target = RULES.slowScale;
    if (this.killcam) this.timeScale = target;
    else { this.timeScale += (target - this.timeScale) * Math.min(1, dt*RULES.ramp); if (Math.abs(this.timeScale - target) < 1e-3) this.timeScale = target; }
    this.slow = clamp((1 - this.timeScale) / (1 - RULES.slowScale), 0, 1);
    const wdt = dt*this.timeScale, pdt = dt*mix(1, RULES.playerSlow, this.slow), gdt = dt*mix(1, RULES.weaponSlow, this.slow);
    this.time += wdt;
    if (this.focusOn && !this.killcam) {
      this.focus = Math.max(0, this.focus - RULES.focusDrain*dt); this.stats.focusTime += dt;
      if (this.focus === 0) { this.focusOn = false; this.emit('focusOff', {empty:true}); }
    } else if (!this.focusOn && this.focus < RULES.focusRegenCap) this.focus = Math.min(RULES.focusRegenCap, this.focus + RULES.focusRegen*dt);
    if (!this.killcam && this.dying <= 0) this.stats.time += dt;
    if (this.realTime - this.lastKill > RULES.comboWindow) this.combo = 0;
    this.updatePlayer(dt, pdt, input);
    this.updateWeapon(gdt, input);
    this.updateBullets(wdt);
    for (const b of this.bots) if (b.alive) this.updateBot(b, wdt);
    if (this.bots.some(b => !b.alive)) this.bots = this.bots.filter(b => b.alive);
    this.updateCorpses(wdt);
    this.updateWaves(dt, wdt);
    if (this.dying > 0) {
      this.dying -= dt;
      if (this.dying <= 0) { this.dying = 0; this.finished = true; this.emit('end'); }
    }
  }
}
