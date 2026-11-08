// Tests for the pieces adopted from VANILLAJS v1.2.0: drift-repaying clock
// snapping, the lead solver behind enemy aim, and the paused-frame gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Game, ENEMIES, RULES} from '../src/game.js';
import {FixedClock} from '../src/clock.js';
import {leadIntercept} from '../src/lead.js';
import {FrameGate} from '../src/frame-gate.js';
import {boxAt} from '../src/math.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
const TICK = 1/120;

test('clock snapping steadies rounded 60 Hz timestamps without drifting', () => {
  const frames = [0.0166, 0.0167, 0.0167];
  const plain = new FixedClock({step:TICK}), snapped = new FixedClock({step:TICK, snapTolerance:0.0005});
  const plainSteps = new Set(), snappedSteps = new Set();
  let plainTicks = 0, snappedTicks = 0;
  for (let i = 0; i < 3600; i++) {
    const s = frames[i % 3];
    const a = plain.advance(s, () => { plainTicks++; }); plainSteps.add(a);
    const b = snapped.advance(s, () => { snappedTicks++; }); snappedSteps.add(b);
  }
  assert.ok(plainSteps.size > 1, 'unsnapped clock jitters between tick counts');
  assert.deepEqual([...snappedSteps], [2], 'every frame runs exactly two ticks');
  // 3600 frames of 50 ms per three frames = 60 s of wall time: 7200 ticks.
  assert.ok(Math.abs(snappedTicks - 7200) <= 1, `${snappedTicks} ticks`);
  assert.ok(Math.abs(plainTicks - snappedTicks) <= 1);
});

test('clock snapping repays drift at off-rate displays', () => {
  for (const hz of [30, 59, 61, 75, 144]) {
    const clock = new FixedClock({step:TICK, snapTolerance:0.0005});
    let ticks = 0;
    for (let i = 0; i < hz*60; i++) clock.advance(1/hz, () => { ticks++; });
    assert.ok(Math.abs(ticks - 7200) <= 1, `${hz} Hz ran ${ticks} ticks`);
  }
  assert.throws(() => new FixedClock({step:TICK, snapTolerance:TICK}));
  const clock = new FixedClock({step:TICK, snapTolerance:0.0005});
  clock.advance(TICK*2 - 0.0003, () => {}); assert.ok(clock.drift !== 0);
  clock.reset(); assert.equal(clock.drift, 0); assert.equal(clock.accumulator, 0);
});

test('lead solver finds the constant-velocity intercept', () => {
  const still = leadIntercept([0, 0, 0], [0, 0, -30], [0, 0, 0], 30);
  near(still.time, 1); near(still.direction[2], -1);
  const moving = leadIntercept([0, 0, 0], [0, 0, -30], [5, 0, 0], 30);
  near(Math.hypot(...moving.point), 30*moving.time);
  assert.ok(moving.point[0] > 0 && moving.direction[0] > 0, 'aims ahead of the target');
  assert.equal(leadIntercept([0, 0, 0], [0, 0, -30], [0, 0, -40], 30), null, 'cannot catch a faster target');
  assert.equal(leadIntercept([0, 0, 0], [0, 0, 0], [1, 0, 0], 30), null);
  assert.equal(leadIntercept([0, 0, 0], [0, 0, -30], [0, 0, 0], 30, 0.5), null, 'beyond the horizon');
  assert.equal(leadIntercept([0, 0, NaN], [0, 0, -30], [0, 0, 0], 30), null);
});

function duel(type = 'grunt') {
  const game = new Game('run', 1);
  game.world.solids = []; game.glass = []; game.refreshBlockers();
  game.breakTimer = 999; Object.assign(game.player, {x:0, z:0, yaw:0, pitch:0, invulnerable:0});
  const bot = {id:7, type, scale:ENEMIES[type].scale, x:0, y:0, z:-15, yaw:0, hp:100, maxHp:100, alive:true, phase:0, think:1e9, visible:true,
    moveX:0, moveZ:0, strafe:1, turn:1e9, evade:0, wait:1e9, charge:0, burst:0, burstTimer:0, flash:0, spawnFx:0};
  game.bots = [bot]; game.random = () => 0.5; // no aim error: compare pure aim lines
  return {game, bot};
}
const shotX = game => game.bullets.filter(b => b.owner === 'enemy').at(-1).dir[0];

test('player velocity is tracked at the player pace', () => {
  const {game} = duel();
  for (let i = 0; i < 30; i++) game.step(TICK, {right:true});
  near(game.player.vx, RULES.walk, 1e-6); near(game.player.vz, 0);
  for (let i = 0; i < 30; i++) game.step(TICK, {});
  assert.equal(game.player.vx, 0);
});

// Horizontal aim relative to the same bot's direct shot at a standing player
// (the muzzle sits off-centre, so a direct shot is not straight down -Z).
function leadOf(type, player = {}, solids = []) {
  const direct = duel(type); direct.game.world.solids = solids; direct.game.refreshBlockers();
  assert.ok(direct.game.fireEnemy(direct.bot));
  const moving = duel(type); moving.game.world.solids = solids; moving.game.refreshBlockers();
  Object.assign(moving.game.player, player);
  assert.ok(moving.game.fireEnemy(moving.bot));
  return shotX(moving.game) - shotX(direct.game);
}

test('grunts lead a walking target; nobody leads a dive, heavies never lead', () => {
  const grunt = leadOf('grunt', {vx:RULES.walk});
  assert.ok(grunt > 0.02, `grunt aims ahead (${grunt})`);
  // Partial lead: less than a perfect intercept would need.
  const full = leadIntercept([0.5, 1.14, -15.95], [0, 1.04, 0], [RULES.walk, 0, 0], RULES.enemyBullet);
  assert.ok(grunt < full.direction[0] - (-0.5/16));
  const runner = leadOf('runner', {vx:RULES.walk});
  assert.ok(runner > 0 && runner < grunt, 'runners lead less');
  near(leadOf('heavy', {vx:RULES.walk}), 0, 1e-12);
  // A diving player is shorter, so the direct line itself dips slightly.
  near(leadOf('grunt', {vx:RULES.diveSpeed, diving:true}), 0, 1e-4);
  assert.ok(leadOf('grunt', {vx:-RULES.walk}) < -0.02, 'leads either way');
});

test('a lead point behind cover falls back to the direct line', () => {
  // A pillar right of the line of fire hides the lead point, not the player.
  const pillar = [boxAt(1.6, 0, -2, 0.6, 3, 0.6)];
  const {game, bot} = duel(); game.world.solids = pillar; game.refreshBlockers();
  assert.ok(game.botSight(bot).visible);
  near(leadOf('grunt', {vx:RULES.walk}, pillar), 0, 1e-12);
  assert.ok(leadOf('grunt', {vx:RULES.walk}) > 0.02, 'open ground still leads');
});

test('frame gate skips unchanged frames and redraws on any change', () => {
  const gate = new FrameGate();
  let draws = 0; const draw = () => { draws++; };
  const frame = {key:'paused|10|1', width:640, height:360};
  assert.equal(gate.present(frame, draw), true);
  for (let i = 0; i < 5; i++) assert.equal(gate.present(frame, draw), false);
  assert.equal(draws, 1);
  assert.equal(gate.present({...frame, key:'paused|11|1'}, draw), true);
  assert.equal(gate.present({...frame, key:'paused|11|1', width:800}, draw), true);
  assert.equal(gate.present({...frame, key:'paused|11|1', width:800, contextEpoch:1}, draw), true);
  gate.invalidate(); assert.equal(gate.present({...frame, key:'paused|11|1', width:800, contextEpoch:1}, draw), true);
  assert.equal(draws, 5);
  assert.deepEqual(gate.stats(), {drawn:5, skipped:5, dirty:false});
  // A failed draw never leaves a clean frame behind.
  assert.throws(() => gate.present({...frame, key:'x'}, () => { throw new Error('lost'); }));
  assert.equal(gate.dirty, true); assert.equal(gate.present({...frame, key:'x'}, draw), true);
  // Invalidation during a draw keeps the next frame dirty; reentrancy is rejected.
  gate.present({...frame, key:'y'}, () => gate.invalidate()); assert.equal(gate.dirty, true);
  assert.throws(() => gate.present({...frame, key:'z'}, () => gate.present(frame, draw)), /reentrant/);
  assert.throws(() => gate.present({key:{}, width:1, height:1}, draw), TypeError);
  assert.throws(() => gate.present({key:'a', width:0, height:1}, draw), RangeError);
});
