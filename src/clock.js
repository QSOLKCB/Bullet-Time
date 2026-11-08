// SPDX-License-Identifier: Apache-2.0
// Fixed-step accumulator adapted from QSOLKCB/VANILLAJS v1.2.0 modules/time (FixedClock),
// including its optional drift-repaying timestamp snapping.
// The game always advances in fixed REAL-time ticks. Bullet time is applied inside
// the simulation (world, player and weapon clocks), so input sampling, mouse look
// and determinism are unaffected by how slow the world is running.
export class FixedClock {
  constructor({step = 1/120, maxFrame = 0.1, maxSteps = 16, snapTolerance = 0} = {}) {
    if (!(Number.isFinite(step) && step > 0 && Number.isFinite(maxFrame) && maxFrame > 0 && Number.isInteger(maxSteps) && maxSteps > 0 &&
      Number.isFinite(snapTolerance) && snapTolerance >= 0 && snapTolerance < step/2)) {
      throw new RangeError('invalid fixed clock limits');
    }
    Object.assign(this, {step, maxFrame, maxSteps, snapTolerance, drift:0, accumulator:0, ticks:0});
  }
  reset() { this.accumulator = 0; this.drift = 0; }
  // Runs update(step) for every whole tick in the elapsed frame. A stalled frame
  // is clamped (never one giant step) and any unrecoverable backlog is dropped.
  // With snapTolerance > 0 (seconds), a frame that is within tolerance of a whole
  // number of ticks runs exactly that many, so browser-rounded 16.6/16.7 ms vsync
  // timestamps stop alternating 1-2-3 ticks per frame. The signed drift is kept
  // below the tolerance and repaid in full on the next unsnapped frame, so the
  // simulation never runs at a different rate from the wall clock.
  advance(seconds, update) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('invalid elapsed time');
    let clamped = Math.min(seconds, this.maxFrame);
    if (this.snapTolerance > 0) {
      const whole = Math.round(clamped / this.step), candidate = this.drift + clamped - whole*this.step;
      if (whole >= 1 && Math.abs(candidate) < this.snapTolerance) { this.drift = candidate; clamped = whole*this.step; }
      else {
        const payable = clamped + this.drift;
        // A very short frame cannot repay a negative debt; carry it forward.
        if (payable < 0) { clamped = 0; this.drift = payable; } else { clamped = payable; this.drift = 0; }
      }
    }
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator + 1e-12 >= this.step && steps < this.maxSteps) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      this.ticks++; steps++;
      if (update(this.step) === false) { this.accumulator = 0; this.drift = 0; break; }
    }
    if (this.accumulator >= this.step) this.accumulator %= this.step;
    return steps;
  }
}
