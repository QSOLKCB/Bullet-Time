// SPDX-License-Identifier: Apache-2.0
// Fixed-step accumulator adapted from QSOLKCB/VANILLAJS modules/time (FixedClock).
// The game always advances in fixed REAL-time ticks. Bullet time is applied inside
// the simulation (world, player and weapon clocks), so input sampling, mouse look
// and determinism are unaffected by how slow the world is running.
export class FixedClock {
  constructor({step = 1/120, maxFrame = 0.1, maxSteps = 16} = {}) {
    if (!(Number.isFinite(step) && step > 0 && Number.isFinite(maxFrame) && maxFrame > 0 && Number.isInteger(maxSteps) && maxSteps > 0)) {
      throw new RangeError('invalid fixed clock limits');
    }
    Object.assign(this, {step, maxFrame, maxSteps, accumulator:0, ticks:0});
  }
  reset() { this.accumulator = 0; }
  // Runs update(step) for every whole tick in the elapsed frame. A stalled frame
  // is clamped (never one giant step) and any unrecoverable backlog is dropped.
  advance(seconds, update) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('invalid elapsed time');
    this.accumulator += Math.min(seconds, this.maxFrame);
    let steps = 0;
    while (this.accumulator + 1e-12 >= this.step && steps < this.maxSteps) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      this.ticks++; steps++;
      if (update(this.step) === false) { this.accumulator = 0; break; }
    }
    if (this.accumulator >= this.step) this.accumulator %= this.step;
    return steps;
  }
}
