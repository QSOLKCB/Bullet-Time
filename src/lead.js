// SPDX-License-Identifier: Apache-2.0
// Constant-velocity intercept adapted from QSOLKCB/VANILLAJS v1.2.0
// modules/lead-solver (leadIntercept). No gravity, obstacles or acceleration:
// the caller decides how much of the lead to use and checks cover itself.
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const finite = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// Earliest intercept time t >= 0 where a projectile launched from `shooter` at
// `speed` meets a target at `target` moving with `velocity`. Returns
// {time, direction, point} or null when no intercept exists within maxTime.
export function leadIntercept(shooter, target, velocity, speed, maxTime = 30) {
  if (!finite(shooter) || !finite(target) || !finite(velocity) || !(speed > 0) || !Number.isFinite(speed) || !(maxTime >= 0)) return null;
  const r = [target[0]-shooter[0], target[1]-shooter[1], target[2]-shooter[2]];
  const c = dot(r, r);
  if (c === 0) return null; // Coincident: no unique direction.
  const vv = dot(velocity, velocity), ss = speed*speed, a = vv - ss, b = 2*dot(r, velocity);
  let roots;
  // Near-linear limit (target as fast as the round) avoids catastrophic cancellation.
  if (Math.abs(a) <= 32*Number.EPSILON*Math.max(1, vv, ss)) roots = b < 0 ? [-c/b] : [];
  else {
    const disc = b*b - 4*a*c;
    if (!Number.isFinite(disc) || disc < 0) return null;
    const s = Math.sqrt(disc), q = -0.5*(b + (b >= 0 ? s : -s));
    roots = q === 0 ? [-b/(2*a)] : [q/a, c/q];
  }
  let time = Infinity;
  for (const t of roots) if (Number.isFinite(t) && t >= 0 && t <= maxTime && t < time) time = t;
  if (!Number.isFinite(time)) return null;
  const point = target.map((v, i) => v + velocity[i]*time), flight = point.map((v, i) => v - shooter[i]);
  const norm = Math.hypot(...flight);
  if (!(norm > 0)) return null;
  return {time, direction:flight.map(v => v/norm), point};
}
