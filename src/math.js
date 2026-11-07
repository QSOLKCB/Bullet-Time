// Column-major matrices, matching WebGL. World up is +Y; yaw 0 looks down -Z.
// Foundation adapted from QSOLKCB/QUICKSCOPER (Apache-2.0), extended with camera
// roll, oriented transforms and segment helpers for travelling bullets.
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export function forward(yaw, pitch = 0) {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
export function perspective(fov, aspect, near = 0.05, far = 160) {
  const f = 1 / Math.tan(fov / 2), n = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*n,-1, 0,0,2*far*near*n,0]);
}
export function view(eye, yaw, pitch) {
  const s = Math.sin(yaw), c = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = [c, 0, s], y = [-s*sp, cp, c*sp], z = [-s*cp, -sp, c*cp];
  const dot = a => -(a[0]*eye[0] + a[1]*eye[1] + a[2]*eye[2]);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, dot(x),dot(y),dot(z),1]);
}
// Rotation about the camera's view axis (applied after the view matrix).
export function roll(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
}
// Look along an arbitrary direction (bullet camera). Returns yaw and pitch.
export function aimAngles(dir) {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return {yaw: Math.atan2(dir[0], -dir[2]), pitch: Math.asin(clamp(dir[1] / len, -1, 1))};
}
export function transform(m, p) {
  return [0,1,2,3].map(r => m[r]*p[0] + m[4+r]*p[1] + m[8+r]*p[2] + m[12+r]);
}
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Slab ray/box intersection. Parallel axes and origins inside a box are valid.
export function rayBox(origin, direction, box, max = Infinity) {
  let near = 0, far = max;
  for (let axis = 0; axis < 3; axis++) {
    const min = box.min[axis], hi = box.max[axis], d = direction[axis];
    if (Math.abs(d) < 1e-9) {
      if (origin[axis] < min || origin[axis] > hi) return null;
    } else {
      let a = (min-origin[axis])/d, b = (hi-origin[axis])/d;
      if (a > b) [a,b] = [b,a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return null;
    }
  }
  return near;
}
export function boxAt(x, y, z, w, h, d) {
  return {min:[x-w/2,y-h/2,z-d/2], max:[x+w/2,y+h/2,z+d/2]};
}
// Distance from point p to segment origin + dir * [0, length]. dir is unit length.
export function segmentDistance(origin, dir, length, p) {
  const t = clamp((p[0]-origin[0])*dir[0] + (p[1]-origin[1])*dir[1] + (p[2]-origin[2])*dir[2], 0, length);
  return Math.hypot(origin[0]+dir[0]*t-p[0], origin[1]+dir[1]*t-p[1], origin[2]+dir[2]*t-p[2]);
}
// Rotation used by figures: tilt about local X (fall backwards), then yaw about Y.
// Returns a row-major 3x3 so callers can write R·v cheaply.
export function figureRotation(yaw, tilt = 0, lean = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), cl = Math.cos(lean), sl = Math.sin(lean);
  // Lean about local Z first (sideways tumble), then tilt, then yaw.
  const L = [cl,-sl,0, sl,cl,0, 0,0,1];
  const T = [1,0,0, 0,ct,-st, 0,st,ct];
  const Y = [cy,0,sy, 0,1,0, -sy,0,cy];
  const m = (a,b) => { const o = new Array(9); for (let r=0;r<3;r++) for (let c=0;c<3;c++) o[r*3+c] = a[r*3]*b[c] + a[r*3+1]*b[3+c] + a[r*3+2]*b[6+c]; return o; };
  return m(Y, m(T, L));
}
