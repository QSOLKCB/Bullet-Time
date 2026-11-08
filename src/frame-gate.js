// SPDX-License-Identifier: Apache-2.0
// Retained-frame gate adapted from QSOLKCB/VANILLAJS v1.2.0 modules/frame-gate
// (FrameGate). The caller supplies a complete primitive key for everything that
// affects the image; an unchanged key, size and context epoch skips the draw and
// the browser keeps showing the last composited frame. Failed draws stay dirty.
export class FrameGate {
  #dirty = true; #generation = 0; #last = null; #active = false; #draws = 0; #skips = 0;
  get dirty() { return this.#dirty; }
  invalidate() { this.#dirty = true; this.#generation++; }
  present({key, width, height, contextEpoch = 0}, draw) {
    if (this.#active) throw new Error('FrameGate is not reentrant');
    if (!(typeof key === 'string' || (typeof key === 'number' && Number.isFinite(key)))) throw new TypeError('primitive frame key required');
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) throw new RangeError('frame size must be positive integers');
    if (!Number.isSafeInteger(contextEpoch) || contextEpoch < 0) throw new RangeError('invalid context epoch');
    const last = this.#last;
    if (!this.#dirty && last && Object.is(last.key, key) && last.width === width && last.height === height && last.contextEpoch === contextEpoch) { this.#skips++; return false; }
    const generation = this.#generation;
    this.#active = true;
    try {
      draw();
      this.#last = {key, width, height, contextEpoch}; this.#draws++;
      // A draw that itself invalidates leaves the next frame dirty.
      this.#dirty = generation !== this.#generation;
      return true;
    } catch (error) { this.#dirty = true; throw error; }
    finally { this.#active = false; }
  }
  stats() { return {drawn:this.#draws, skipped:this.#skips, dirty:this.#dirty}; }
}
