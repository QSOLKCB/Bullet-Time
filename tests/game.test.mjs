import test from 'node:test';
import assert from 'node:assert/strict';
import {forward, view, perspective, multiply, transform, roll, aimAngles, rayBox, boxAt, segmentDistance, figureRotation} from '../src/math.js';
import {Game, RULES, WEAPONS, ENEMIES, traceShot, moveBody} from '../src/game.js';
import {FixedClock} from '../src/clock.js';
import {Navigation} from '../src/navigation.js';
import {makeWorld} from '../src/world.js';
import {musicStep} from '../src/music.js';
import {stick, XboxInput} from '../src/controller.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
const TICK = 1/120;
function advance(game, seconds, input = {}) { for (let i = 0; i < Math.round(seconds*120); i++) game.step(TICK, input); }
// A bare arena with one stationary target in front of the player.
function range(mode = 'practice', bot = {}, seed = 1) {
  const game = new Game(mode, seed);
  game.world.solids = []; game.glass = []; game.refreshBlockers();
  game.breakTimer = 999; game.player.invulnerable = 0;
  Object.assign(game.player, {x:0, z:0, yaw:0, pitch:0});
  const target = {id:99, type:'grunt', scale:1, x:0, y:0, z:-15, yaw:0, hp:100, maxHp:100, alive:true, phase:0, think:99, visible:false,
    moveX:0, moveZ:0, strafe:1, turn:99, evade:0, wait:999, charge:0, burst:0, burstTimer:0, flash:0, spawnFx:0, ...bot};
  game.bots = [target];
  game.player.pitch = Math.atan2(1.2 - 1.68, 15); // aim at the torso
  return {game, target};
}
const freeze = bot => { bot.think = 1e9; bot.wait = 1e9; bot.turn = 1e9; };

test('view, roll and projection keep the aim point centred', () => {
  for (const [yaw, pitch] of [[0, 0], [1.1, 0.5], [-2, -0.8]]) {
    const eye = [7, 3, -4], f = forward(yaw, pitch), v = view(eye, yaw, pitch);
    transform(v, eye).slice(0, 3).forEach(x => near(x, 0));
    const p = transform(v, eye.map((x, i) => x + f[i]*10)); near(p[0], 0); near(p[1], 0); near(p[2], -10);
    const a = aimAngles(f); near(a.yaw, Math.atan2(Math.sin(yaw), Math.cos(yaw))); near(a.pitch, pitch);
  }
  const clip = transform(multiply(perspective(Math.PI/2, 16/9), multiply(roll(0.7), view([3, 2, 10], 0.3, 0.1))), [3, 2, 10].map((x, i) => x + forward(0.3, 0.1)[i]*20));
  near(clip[0], 0); near(clip[1], 0); assert.ok(clip[3] > 0);
});

test('ray, segment and figure rotation helpers', () => {
  const b = boxAt(0, 0, -5, 2, 2, 2);
  near(rayBox([0, 0, 0], [0, 0, -1], b), 4); assert.equal(rayBox([0, 0, 0], [0, 0, 1], b), null); assert.equal(rayBox([0, 0, 0], [0, 0, -1], b, 3), null);
  near(segmentDistance([0, 0, 0], [1, 0, 0], 10, [5, 2, 0]), 2); near(segmentDistance([0, 0, 0], [1, 0, 0], 10, [-3, 4, 0]), 5);
  const R = figureRotation(0, Math.PI/2); // fallen on its back: the head moves to local +Z
  near(R[1]*1, 0); near(R[4], 0, 1e-9); near(R[7], 1);
});

test('fixed clock clamps stalls and runs whole ticks only', () => {
  const clock = new FixedClock({step:TICK, maxFrame:0.1});
  let n = 0; clock.advance(0.5, () => { n++; }); assert.equal(n, 12);
  n = 0; clock.advance(TICK/2, () => { n++; }); assert.equal(n, 0);
  n = 0; clock.advance(TICK/2 + 1e-9, () => { n++; }); assert.equal(n, 1);
  assert.throws(() => clock.advance(-1, () => {}));
});

test('bullets are real projectiles: they take time to arrive', () => {
  const {game, target} = range(); freeze(target);
  game.requestShot();
  assert.equal(game.bullets.length, 1);
  assert.equal(target.hp, 100, 'no instant hitscan');
  advance(game, 0.05);
  assert.equal(target.hp, 100, 'still in flight after 50 ms');
  advance(game, 0.07);
  assert.ok(target.hp < 100 || !target.alive, 'the round arrives after ~0.1 s at 15 m');
  assert.equal(game.bullets.length, 0);
});

test('bullet time slows the world, half-slows the player and never slows the trigger much', () => {
  const {game, target} = range(); freeze(target);
  assert.ok(game.toggleFocus());
  advance(game, 1);
  near(game.timeScale, RULES.slowScale, 1e-3);
  assert.ok(game.slow > 0.99);
  const worldBefore = game.time; advance(game, 1);
  near(game.time - worldBefore, RULES.slowScale, 1e-3);
  // A bullet fired now covers far less ground per real second.
  game.requestShot(); advance(game, 0.05);
  assert.equal(target.hp, 100, 'still in flight in bullet time');
  assert.equal(game.bullets.length, 1);
  const travelled = game.bullets[0].traveled;
  near(travelled, RULES.playerBullet*RULES.slowScale*0.05, 0.1);
  // Player walking speed is halved, not quartered.
  const z = game.player.z; advance(game, 0.5, {forward:true});
  near(z - game.player.z, RULES.walk*RULES.playerSlow*0.5, 0.05);
  // Weapon cycling: twin pistols fire again within 0.11 / 0.8 s of real time.
  game.weapon.cooldown = 0; game.requestShot(); const shots = game.stats.shots;
  advance(game, WEAPONS[0].cycle/RULES.weaponSlow + 0.02); game.requestShot();
  assert.equal(game.stats.shots, shots + 1);
});

test('bullet time drains the hourglass, refuses when empty and kills refill it', () => {
  const {game, target} = range(); freeze(target);
  game.focus = 20; game.toggleFocus(); advance(game, 3);
  assert.equal(game.focusOn, false); assert.equal(game.focus <= RULES.focusRegenCap, true);
  assert.ok(game.drainEvents().some(e => e.type === 'focusOff' && e.empty));
  game.focus = 2; assert.equal(game.toggleFocus(), false);
  game.focus = 10; game.requestShot(); advance(game, 0.3); game.requestShot(); advance(game, 0.3);
  assert.equal(target.alive, false); assert.ok(game.focus >= 10 + RULES.focusKill - 1);
});

test('enemy bullets travel, can be dodged and damage the player on contact', () => {
  const {game, target} = range('run');
  freeze(target); target.z = -12; game.player.invulnerable = 0;
  assert.ok(game.fireEnemy(target));
  const bullet = game.bullets.find(b => b.owner === 'enemy');
  assert.ok(bullet);
  advance(game, 0.1); assert.equal(game.player.health, 100, 'not hitscan');
  advance(game, 0.5); assert.ok(game.player.health < 100);
  // Same shot, but the player steps aside while it is in flight.
  const second = range('run'); freeze(second.target); second.target.z = -12; second.game.player.invulnerable = 0;
  second.game.random = () => 0.5; second.game.fireEnemy(second.target);
  second.game.toggleFocus(); advance(second.game, 0.3, {right:true}); advance(second.game, 1.5);
  assert.equal(second.game.player.health, 100);
  assert.ok(second.game.drainEvents().some(e => e.type === 'whiz'), 'a near miss whistles');
});

test('shootdodge dives in the move direction, triggers slow motion and lands prone', () => {
  const {game, target} = range(); freeze(target);
  game.step(TICK, {dive:true, right:true});
  const p = game.player;
  assert.ok(p.diving); assert.ok(p.diveX > 0.99);
  advance(game, 0.15); assert.ok(game.slow > 0.5, 'diving bends time without the meter');
  assert.equal(game.playerHeight(), 0.8);
  advance(game, 3);
  assert.equal(p.diving, false); assert.ok(p.x > 3, `dove ${p.x} m`);
  const events = game.drainEvents().map(e => e.type);
  assert.ok(events.includes('dive') && events.includes('land') && events.includes('getUp'));
  near(game.timeScale, 1, 1e-3);
  // No direction: dive backwards.
  game.player.diveCooldown = 0; game.step(TICK, {dive:true}); assert.ok(game.player.diveZ > 0.99);
});

test('kills in a dive or in bullet time earn style points and a ragdoll corpse', () => {
  const {game, target} = range(); freeze(target);
  game.step(TICK, {dive:true, left:true}); advance(game, 0.12);
  game.player.pitch = Math.atan2(2 - game.eyePosition()[1], 15);
  game.player.yaw = Math.atan2(-game.player.x, 15);
  for (let i = 0; i < 6 && target.alive; i++) { game.weapon.cooldown = 0; game.requestShot(); advance(game, 0.15); }
  assert.equal(target.alive, false);
  const kill = game.drainEvents().find(e => e.type === 'kill');
  assert.ok(kill.air && kill.slow, 'mid-dive kill fired in bullet time');
  assert.ok(kill.points >= ENEMIES.grunt.points + 150);
  assert.equal(game.corpses.length, 1);
  const corpse = game.corpses[0];
  advance(game, 2);
  assert.ok(corpse.tilt > 1.2, 'the body falls backwards'); assert.ok(corpse.z < -15, 'and is pushed by the round');
});

test('headshots, collateral hitboxes rotate with the bot and walls stop rounds', () => {
  const bot = {x:0, y:0, z:-10, yaw:0.7, alive:true, scale:1};
  const head = traceShot([0, 1.93, 0], [0, 0, -1], [], [bot]); assert.equal(head.part, 'head');
  const wall = boxAt(0, 1, -5, 4, 2, 0.5);
  assert.equal(traceShot([0, 1.2, 0], [0, 0, -1], [wall], [bot]).kind, 'wall');
  const {game, target} = range(); freeze(target);
  game.world.solids = [wall]; game.refreshBlockers();
  game.requestShot(); advance(game, 0.5);
  assert.equal(target.hp, 100);
  assert.ok(game.drainEvents().some(e => e.type === 'impact'));
});

test('glass shatters when shot or barged through but never stops a round', () => {
  const {game, target} = range(); freeze(target);
  game.glass = [{id:0, ...boxAt(0, 1.45, -7, 5, 2.9, 0.08), x:0, y:1.45, z:-7, w:5, h:2.9, d:0.08, intact:true}]; game.refreshBlockers();
  game.requestShot(); advance(game, 0.3);
  assert.equal(game.glass[0].intact, false); assert.ok(target.hp < 100);
  assert.equal(game.blockers.length, 0);
  // Enemies smash through intact panes in their way.
  const second = range(); second.game.glass = [{id:0, ...boxAt(0, 1.45, -14.5, 5, 2.9, 0.08), intact:true}]; second.game.refreshBlockers();
  second.game.moveBot(second.target, 0, 0.02, 2.2);
  assert.equal(second.game.glass[0].intact, false);
});

test('diving shatters arena glass on body contact while walking still stops', () => {
  for (const x of [0, 2.85]) {
    const game = new Game('practice'); game.breakTimer = 999;
    Object.assign(game.player, {x, z:12});
    const pane = game.glass.find(g => g.z === 11);
    game.step(TICK, {dive:true, forward:true}); advance(game, 1);
    assert.equal(pane.intact, false, `dive at x=${x} breaks the pane, including radius contact`);
    assert.ok(game.player.z < 11, 'the dive continues through the partition');
    assert.equal(game.stats.glass, 1);
    assert.equal(game.drainEvents().filter(e => e.type === 'glass').length, 1);
    assert.ok(!game.blockers.includes(pane));
  }
  const walking = new Game('practice'); walking.breakTimer = 999;
  Object.assign(walking.player, {x:0, z:12}); advance(walking, 0.5, {forward:true});
  assert.ok(walking.player.z > 11.3);
  assert.equal(walking.glass.find(g => g.z === 11).intact, true);
});

test('a diving player cannot break glass through solid cover', () => {
  const {game, target} = range(); freeze(target);
  game.world.solids = [boxAt(0, 1.5, -1, 5, 3, 0.5)];
  game.glass = [{id:0, ...boxAt(0, 1.45, -2, 5, 2.9, 0.08), intact:true}]; game.refreshBlockers();
  game.step(TICK, {dive:true, forward:true}); advance(game, 1);
  assert.ok(game.player.z > -0.5);
  assert.equal(game.glass[0].intact, true);
});

test('weapons: switching, shotgun pellets, automatic carbine and reloading', () => {
  const {game, target} = range(); freeze(target);
  assert.ok(game.switchWeapon(1)); advance(game, 0.4);
  game.requestShot(); assert.equal(game.bullets.length, WEAPONS[1].pellets);
  game.switchWeapon(2); advance(game, 0.4);
  const before = game.ammo[2]; advance(game, 0.5, {fire:true});
  assert.ok(before - game.ammo[2] >= 5, 'holding fire keeps the carbine firing');
  advance(game, 0.2); game.ammo[2] = 0; game.requestShot();
  assert.ok(game.weapon.reload > 0); advance(game, WEAPONS[2].reload + 0.1);
  assert.equal(game.ammo[2], WEAPONS[2].mag);
});

test('new guns: the revolver one-shots a torso, the vipers alternate hands on full auto', () => {
  const index = id => WEAPONS.findIndex(w => w.id === id);
  let {game, target} = range(); freeze(target);
  assert.ok(game.switchWeapon(index('revolver'))); advance(game, 0.4);
  game.requestShot(); advance(game, 0.2);
  assert.equal(target.alive, false, 'a .50 body shot drops a grunt');
  ({game, target} = range()); freeze(target); target.hp = target.maxHp = 1e6;
  const v = index('vipers'); game.switchWeapon(v); advance(game, 0.4);
  const hands = []; game.drainEvents();
  advance(game, 0.3, {fire:true});
  for (const e of game.drainEvents()) if (e.type === 'shot') hands.push(e.hand);
  assert.ok(hands.length >= 5, 'holding fire keeps the vipers firing');
  assert.ok(hands.every((h, i) => i === 0 || h === -hands[i - 1]), 'shots alternate between hands');
  assert.equal(game.ammo[v], WEAPONS[v].mag - hands.length);
});

test('the marksman rifle round is faster and pierces bodies, but never cover', () => {
  const r = WEAPONS.findIndex(w => w.id === 'rifle');
  const {game, target} = range(); freeze(target);
  const behind = {...target, id:100, z:-22, hp:100, alive:true}; freeze(behind); game.bots.push(behind);
  game.switchWeapon(r); advance(game, 0.4);
  const [bullet] = game.requestShot();
  assert.ok(bullet.speed > RULES.playerBullet);
  advance(game, 0.3);
  assert.equal(target.alive, false); assert.equal(behind.alive, false, 'one round, two bodies');
  assert.equal(game.stats.kills, 2); assert.equal(game.stats.hits, 1, 'accuracy counts the trigger pull once');
  // A wall between the two stops the round after the first body.
  const blocked = range(); freeze(blocked.target);
  const hidden = {...blocked.target, id:101, z:-24, hp:100, alive:true}; freeze(hidden); blocked.game.bots.push(hidden);
  blocked.game.world.solids = [boxAt(0, 1, -19, 6, 4, 0.5)];
  blocked.game.switchWeapon(r); advance(blocked.game, 0.4); blocked.game.requestShot(); advance(blocked.game, 0.3);
  assert.equal(blocked.target.alive, false); assert.equal(hidden.alive, true, 'cover stops a piercing round');
});

test('the final kill of a wave triggers the bullet camera, then play resumes', () => {
  const {game, target} = range('run'); freeze(target);
  game.mode = 'run'; game.wave = 1; game.queue = []; game.breakTimer = 0;
  game.player.pitch = Math.atan2(1.93 - 1.68, 15); // headshot: lethal in one round
  game.requestShot();
  assert.ok(game.killcam, 'killcam predicted'); assert.equal(game.killcam.phase, 'flight');
  advance(game, 0.5); assert.ok(target.alive, 'the final round is in extreme slow motion');
  advance(game, RULES.killcamFlight + 0.4);
  assert.equal(target.alive, false); assert.equal(game.killcam?.phase, 'impact');
  advance(game, RULES.killcamHold + 0.2);
  assert.equal(game.killcam, null);
  const types = game.drainEvents().map(e => e.type);
  assert.ok(types.includes('killcamStart') && types.includes('killcamImpact') && types.includes('killcamEnd') && types.includes('waveClear'));
  // A shot that would not kill does not start it.
  const other = range('run'); freeze(other.target); other.game.wave = 1; other.game.queue = []; other.game.breakTimer = 0;
  other.target.hp = 500; other.game.requestShot(); assert.equal(other.game.killcam, null);
  // And players can switch it off.
  const off = range('run'); off.game.options.killcam = false; off.game.wave = 1; off.game.queue = []; off.game.breakTimer = 0;
  off.game.player.pitch = Math.atan2(1.93 - 1.68, 15); off.game.requestShot(); assert.equal(off.game.killcam, null);
});

test('a piercing round that clears the wave gets the final-bullet camera on the last body', () => {
  const r = WEAPONS.findIndex(w => w.id === 'rifle');
  const setup = () => {
    const {game, target} = range('run'); freeze(target);
    const behind = {...target, id:100, z:-22, hp:100, alive:true}; freeze(behind); game.bots.push(behind);
    game.wave = 1; game.queue = []; game.breakTimer = 0; game.weapon.index = r;
    return {game, target, behind};
  };
  const {game, target, behind} = setup();
  game.requestShot();
  assert.equal(game.killcam?.phase, 'flight', 'one round that kills both remaining enemies gets the camera');
  assert.equal(game.killcam.target, behind, 'the camera rides to the last body in line');
  advance(game, RULES.killcamFlight + 0.6);
  assert.equal(target.alive, false); assert.equal(behind.alive, false);
  assert.equal(game.killcam?.phase, 'impact');
  advance(game, RULES.killcamHold + 0.2);
  const types = game.drainEvents().map(e => e.type);
  assert.ok(types.includes('killcamStart') && types.includes('killcamImpact') && types.includes('killcamEnd') && types.includes('waveClear'));
  // If the round can't finish everyone, there's no camera.
  const tough = setup(); tough.behind.hp = 500; tough.game.requestShot(); assert.equal(tough.game.killcam, null);
  // Nor when cover shields the last enemy.
  const covered = setup(); covered.game.world.solids = [boxAt(0, 1, -19, 6, 4, 0.5)]; covered.game.requestShot(); assert.equal(covered.game.killcam, null);
  // And a non-piercing gun still needs a single last enemy.
  const pistol = setup(); pistol.game.weapon.index = 0; pistol.game.player.pitch = Math.atan2(1.93 - 1.68, 15); pistol.game.requestShot(); assert.equal(pistol.game.killcam, null);
});

test('a shotgun final kill keeps the camera through nonlethal pellets and the impact orbit', () => {
  const {game, target} = range('run', {z:-5}, 2); freeze(target);
  game.wave = 1; game.breakTimer = 0; game.weapon.index = 1;
  game.player.pitch = Math.atan2(1.2 - game.player.eye, 5);
  game.requestShot();
  assert.equal(game.killcam?.phase, 'flight');
  advance(game, RULES.killcamFlight + 0.4);
  assert.equal(target.alive, false);
  assert.equal(game.killcam?.phase, 'impact');
  assert.equal(game.killcam.corpse, game.corpses[0]);
  const events = game.drainEvents();
  assert.equal(events.find(e => e.type === 'hit').killed, false, 'several pellets are needed');
  assert.equal(events.filter(e => e.type === 'killcamImpact').length, 1);
  assert.ok(!events.some(e => e.type === 'killcamEnd' || e.type === 'waveClear'));
  advance(game, RULES.killcamHold + 0.2);
  assert.equal(game.killcam, null);
  assert.deepEqual(game.drainEvents().filter(e => ['killcamEnd', 'waveClear'].includes(e.type)).map(e => e.type), ['killcamEnd', 'waveClear']);
});

test('a predicted shotgun kill that misses releases the camera when the blast expires', () => {
  const {game, target} = range('run', {z:-5}); freeze(target);
  game.weapon.index = 1; game.player.pitch = Math.atan2(1.2 - game.player.eye, 5);
  game.requestShot(); assert.ok(game.killcam);
  target.x = 20; // Move out of the blast after prediction.
  for (const bullet of game.bullets) bullet.max = 6;
  advance(game, 3);
  assert.equal(game.killcam, null); assert.equal(target.alive, true);
  assert.ok(!game.drainEvents().some(e => e.type === 'killcamImpact'));
});

test('waves spawn away from the player, escalate and award bonuses', () => {
  const game = new Game('run', 5);
  advance(game, RULES.firstWave + 0.05);
  assert.equal(game.wave, 1);
  advance(game, 1);
  assert.ok(game.bots.length >= 1);
  for (const b of game.bots) assert.ok(Math.hypot(b.x - game.player.x, b.z - game.player.z) > 10);
  game.bots = []; game.queue = []; advance(game, TICK*2);
  assert.ok(game.drainEvents().some(e => e.type === 'waveClear'));
  advance(game, RULES.waveBreak + 0.1); assert.equal(game.wave, 2);
  assert.ok(game.queue.length + game.bots.length >= 6);
});

test('enemies telegraph, then fire bursts only with a clear line of sight', () => {
  const {game, target} = range('run');
  target.think = 0; target.wait = 0; target.z = -10;
  advance(game, ENEMIES.grunt.windup + 0.6);
  const shots = game.drainEvents().filter(e => e.type === 'enemyShot').length;
  assert.ok(shots >= 2, `burst fired ${shots}`);
  const blocked = range('run'); blocked.target.think = 0; blocked.target.wait = 0; blocked.target.z = -10;
  blocked.game.world.solids = [boxAt(0, 2, -5, 8, 4, 1)]; blocked.game.refreshBlockers();
  advance(blocked.game, 2);
  assert.ok(!blocked.game.drainEvents().some(e => e.type === 'enemyShot'));
});

test('death plays out in slow motion and ends the run; practice mode is harmless', () => {
  const {game, target} = range('run'); freeze(target);
  game.damage(150, [0, 1, -10]);
  assert.ok(game.dying > 0); advance(game, 0.3); assert.ok(game.timeScale < 0.5);
  advance(game, 2); assert.equal(game.finished, true);
  const practice = range('practice'); assert.equal(practice.game.damage(150), false); assert.equal(practice.game.player.health, 100);
});

test('the arena, navigation, music and controller contracts hold', () => {
  const world = makeWorld();
  assert.ok(world.glass.length >= 4 && world.solids.length > 30);
  const [sx, sz] = world.start;
  assert.ok(!world.solids.some(b => sx > b.min[0] - 0.3 && sx < b.max[0] + 0.3 && sz > b.min[2] - 0.3 && sz < b.max[2] + 0.3), 'player starts in open space');
  for (const [x, z] of world.spawns) assert.ok(!world.solids.some(b => b.min[1] < 2 && x > b.min[0] - 0.4 && x < b.max[0] + 0.4 && z > b.min[2] - 0.4 && z < b.max[2] + 0.4), `spawn ${x},${z} is clear`);
  const nav = new Navigation(world.solids, world.bounds);
  for (const [x, z] of world.spawns) {
    let p = [x, z];
    for (let i = 0; i < 60; i++) p = nav.toward(p[0], p[1], sx, sz);
    assert.ok(Math.hypot(p[0] - sx, p[1] - sz) < 3, `route from ${x},${z}`);
  }
  const body = {x:0, y:0, z:0}; moveBody(body, 5, 0, [boxAt(2, 1, 0, 1, 2, 4)]); assert.ok(body.x < 1.5);
  assert.ok(musicStep(0).length > 0); assert.ok(musicStep(3, 3).length >= musicStep(3, 0).length);
  assert.deepEqual(stick(0.05, 0.05), [0, 0]);
  const pad = new XboxInput(), buttons = () => new Array(17).fill(0).map(() => ({value:0}));
  const make = b => [{index:0, id:'x', connected:true, mapping:'standard', buttons:b, axes:[0, 0, 0, 0]}];
  pad.sample(make(buttons()));
  const b = buttons(); b[6].value = 1; b[7].value = 1; b[1].value = 1;
  const out = pad.sample(make(b)); assert.ok(out.focus && out.fire && out.fireHeld && out.dive);
  assert.equal(pad.sample(make(b)).fire, false, 'trigger fires once per pull');
});

test('navigation routes around thin cover between open cells with body clearance', () => {
  for (const cover of [boxAt(0, 1, 1, 1, 2, 0.1), boxAt(0.7, 1, 1, 0.6, 2, 0.1)]) {
    const nav = new Navigation([cover], {minX:-5, maxX:5, minZ:-1, maxZ:7});
    const a = nav.cell(0, 0), b = nav.cell(0, 2);
    assert.ok(nav.open[a] && nav.open[b], 'both centres are clear');
    assert.ok(!nav.neighbors(a).includes(b) && !nav.neighbors(b).includes(a));
    assert.notDeepEqual(nav.toward(0, 0, 0, 4), [0, 2], 'steering must also reject the blocked shortcut');
    let p = [0, 0];
    for (let i = 0; i < 12; i++) p = nav.toward(...p, 0, 4);
    assert.deepEqual(p, [0, 4], 'an alternate route reaches the goal');
  }
  const world = makeWorld(), nav = new Navigation(world.solids, world.bounds);
  const a = nav.cell(-3, 27), b = nav.cell(-3, 25);
  assert.ok(nav.open[a] && nav.open[b]);
  assert.ok(!nav.neighbors(a).includes(b) && !nav.neighbors(b).includes(a));
  const game = new Game('practice'); game.breakTimer = 999;
  const bot = game.spawnBot('grunt'); Object.assign(bot, {x:0, z:29});
  let reachedSight = false;
  for (let i = 0; i < 90*120; i++) {
    game.step(TICK);
    if (game.botSight(bot).visible) { reachedSight = true; break; }
  }
  assert.ok(reachedSight, 'the grunt escapes the barrier and gains sight of the player');
});

test('navigation recovers from closed source cells using a reachable open centre', () => {
  const cover = boxAt(2.05, 1, 0, 0.1, 2, 1);
  const nav = new Navigation([cover], {minX:-1, maxX:7, minZ:-3, maxZ:5});
  for (const [x, goalX] of [[1.55, 0], [2.55, 4]]) {
    assert.equal(nav.open[nav.cell(x, 0)], 0, 'a valid body position rounds to blocked cover');
    const goal = nav.toward(x, 0, goalX, 0);
    assert.deepEqual(goal, [goalX, 0], 'recovery stays on the reachable side of cover');
    const body = {x, y:0, z:0};
    assert.equal(moveBody(body, goal[0]-x, goal[1], [cover], 0.42, 2.2), false);
    near(body.x, goal[0]); near(body.z, goal[1]);
  }
  // If the target's flow field is behind a wall, stay at the valid position
  // instead of aiming into the closed cell or choosing an unreachable centre.
  const sealed = new Navigation([cover, boxAt(3, 1, 1, 0.1, 2, 20)], {minX:-1, maxX:7, minZ:-3, maxZ:5});
  assert.deepEqual(sealed.toward(1.55, 0, 6, 0), [1.55, 0]);
});

test('a grunt beside the ticket booth escapes its closed cell and gains sight', () => {
  const game = new Game('practice'); game.breakTimer = 999;
  const bot = game.spawnBot('grunt'); Object.assign(bot, {x:-20, z:-28});
  assert.equal(game.navigation.open[game.navigation.cell(bot.x, bot.z)], 0);
  const goal = game.navigation.toward(bot.x, bot.z, game.player.x, game.player.z);
  assert.ok(game.navigation.open[game.navigation.cell(...goal)], 'the initial goal is an open cell');
  const body = {x:bot.x, y:bot.y, z:bot.z};
  assert.equal(moveBody(body, goal[0]-body.x, goal[1]-body.z, game.world.solids, 0.42, 2.2), false, 'the initial goal is reachable without hitting cover');
  let sightAt = null;
  for (let i = 0; i < 10800; i++) {
    game.step(TICK);
    if (game.botSight(bot).visible && sightAt === null) sightAt = (i+1)*TICK;
  }
  assert.ok(sightAt !== null, 'the grunt acquires sight within the 90-second reproduction');
});

test('skin assets: every skin is complete, stored choices are validated and patterns draw decals', async () => {
  const {WEAPON_SKINS, ENEMY_SKINS, DEFAULT_SKINS, normalizeSkins, weaponPattern} = await import('../src/skins.js');
  const {readFile} = await import('node:fs/promises');
  const color = c => Array.isArray(c) && c.length === 3 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 2);
  for (const [id, s] of Object.entries(WEAPON_SKINS)) {
    for (const key of ['metal','edge','grip','accent']) assert.ok(color(s[key]), `${id}.${key}`);
    assert.ok(s.name && s.note);
    await readFile(new URL(`../assets/skins/weapon-${id}.svg`, import.meta.url), 'utf8');
    const decals = []; weaponPattern(s.pattern, [0, 0, 0, 0.04, 0.03, 0.2], s.accent, (...a) => decals.push(a));
    assert.equal(decals.length > 0, s.pattern !== 'none', `${id} pattern`);
  }
  for (const [id, s] of Object.entries(ENEMY_SKINS)) {
    for (const type of Object.keys(ENEMIES)) for (const key of ['suit','trim','skin','visor','shirt','tie']) assert.ok(color(s.looks[type]?.[key]), `${id}.${type}.${key}`);
    await readFile(new URL(`../assets/skins/enemy-${id}.svg`, import.meta.url), 'utf8');
  }
  for (const w of WEAPONS) assert.ok(Object.hasOwn(DEFAULT_SKINS, w.id));
  assert.deepEqual(normalizeSkins({duals:'ember', shotgun:'nope', enemies:'chrome', extra:1}), {...DEFAULT_SKINS, duals:'ember', enemies:'chrome'});
  assert.deepEqual(normalizeSkins('garbage'), DEFAULT_SKINS);
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  for (const id of Object.keys(WEAPON_SKINS)) assert.ok(sw.includes(`weapon-${id}.svg`), 'offline cache lists skin assets');
});

test('skin swatches are well-formed SVG documents', async () => {
  const {readdir, readFile} = await import('node:fs/promises');
  const dir = new URL('../assets/skins/', import.meta.url);
  for (const name of await readdir(dir)) {
    const text = await readFile(new URL(name, dir), 'utf8');
    assert.ok(text.startsWith('<svg') && text.trim().endsWith('</svg>'), name);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(text), `${name} has an unescaped ampersand`);
  }
});
