import {clamp} from './math.js';
// W3C standard Gamepad mapping with Xbox labels (adapted from QSOLKCB/QUICKSCOPER).
export function stick(x = 0, y = 0, deadzone = 0.16, curve = 1) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
  const length = Math.hypot(x, y); if (length <= deadzone) return [0, 0];
  const magnitude = clamp((length - deadzone)/(1 - deadzone), 0, 1)**curve;
  return [x/length*magnitude, y/length*magnitude];
}
const neutral = () => ({connected:false, focus:false, focusHeld:false, fire:false, fireHeld:false, dive:false, reload:false, jump:false, crouch:false, next:false, prev:false, pause:false, accept:false, back:false, up:false, down:false, left:false, right:false, moveX:0, moveZ:0, lookX:0, lookY:0});
export class XboxInput {
  constructor() { this.identity = ''; this.index = -1; this.previous = new Array(17).fill(false); this.reset(); }
  reset() { this.blocked = true; this.previous.fill(false); }
  sample(pads, deadzone = 0.16) {
    const all = Array.from(pads || []), valid = p => p && p.connected !== false && p.mapping === 'standard';
    const pad = all.find(p => valid(p) && p.index === this.index) || all.find(valid);
    const out = neutral();
    if (!pad) { this.identity = ''; this.index = -1; this.reset(); return out; }
    const identity = `${pad.index}:${pad.id}`;
    out.replaced = !!this.identity && identity !== this.identity;
    if (identity !== this.identity) { this.reset(); this.identity = identity; this.index = pad.index; }
    out.connected = true;
    const held = this.previous.map((was, i) => {
      const b = pad.buttons[i], value = Number.isFinite(b?.value) ? b.value : Number(!!b?.pressed);
      return value > (i === 6 || i === 7 ? (was ? 0.25 : 0.55) : 0.5);
    });
    const move = stick(pad.axes[0], pad.axes[1], deadzone), look = stick(pad.axes[2], pad.axes[3], deadzone, 1.6);
    // Resumes and reconnections require a neutral controller first.
    if (this.blocked) { if (!held.some(Boolean) && !move.some(Boolean) && !look.some(Boolean)) this.blocked = false; return out; }
    const edge = i => held[i] && !this.previous[i];
    Object.assign(out, {moveX:move[0], moveZ:-move[1], lookX:look[0], lookY:look[1],
      focus:edge(6), focusHeld:held[6], fire:edge(7), fireHeld:held[7], dive:edge(1), jump:edge(0), reload:edge(2), next:edge(3) || edge(5), prev:edge(4),
      crouch:held[11], pause:edge(9), accept:edge(0), back:edge(1), up:edge(12), down:edge(13), left:edge(14), right:edge(15)});
    this.previous = held; return out;
  }
}
