import {clamp, mix, smooth, perspective, view, roll, multiply, transform, aimAngles, figureRotation} from './math.js';
import {WEAPON_SKINS, ENEMY_SKINS, DEFAULT_SKINS, normalizeSkins, weaponPattern} from './skins.js';
// Raw WebGL renderer (WebGL 2 preferred, WebGL 1 fallback), adapted from the
// QSOLKCB/QUICKSCOPER batched-box renderer. Three draw modes share one program:
//   0 lit geometry, 1 additive points (debris), 2 unlit additive glow (bullets).
// uSlow colour-grades the world during bullet time; glow stays vivid.
const VS = `attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor;
uniform mat4 uVP; uniform vec3 uEye; uniform float uMode; uniform float uPointScale;
varying vec3 vColor; varying float vDepth; varying float vAlpha; varying float vGlow;
void main(){
  vDepth=length(aPosition-uEye);
  gl_Position=uVP*vec4(aPosition,1.0);
  vAlpha=1.0; gl_PointSize=1.0; vGlow=0.0; vColor=aColor;
  if(uMode<0.5){
    float emissive=step(2.6,aColor.r+aColor.g+aColor.b);
    float key=max(dot(aNormal,normalize(vec3(-0.35,0.8,0.45))),0.0);
    float fill=max(dot(aNormal,normalize(vec3(0.55,0.25,-0.6))),0.0);
    float height=clamp(aPosition.y/8.0,0.0,1.0);
    vec3 lit=aColor*(0.38+key*0.55+fill*0.2+height*0.1);
    vColor=mix(lit,min(aColor,vec3(1.0)),emissive); vGlow=emissive;
  } else if(uMode<1.5){
    vAlpha=aNormal.y; vGlow=1.0;
    gl_PointSize=clamp(aNormal.x*uPointScale/max(0.01,gl_Position.w),1.0,22.0);
  } else { vGlow=1.0; }
}`;
const FS = `precision mediump float;
varying vec3 vColor; varying float vDepth; varying float vAlpha; varying float vGlow;
uniform float uFog; uniform float uSlow; uniform float uOpacity; uniform vec3 uFogColor;
void main(){
  vec3 c=vColor;
  float lum=dot(c,vec3(0.299,0.587,0.114));
  vec3 graded=vec3(lum)*vec3(1.12,0.98,0.78);
  graded=(graded-0.42)*1.18+0.42;
  c=mix(c,graded,uSlow*0.78*(1.0-vGlow*0.8));
  float fog=1.0-exp(-vDepth*vDepth*0.00038*uFog);
  c=mix(c,uFogColor,min(fog,0.86)*(1.0-vGlow*0.6));
  gl_FragColor=vec4(c,vAlpha*uOpacity);
}`;
const CUBE = [];
for (const [normal, corners] of [
  [[0,1,0],[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
  [[0,-1,0],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]],
  [[0,0,1],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
  [[0,0,-1],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
  [[1,0,0],[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],
  [[-1,0,0],[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]]
]) for (const i of [0,1,2,0,2,3]) CUBE.push(...corners[i], ...normal);
const IDENTITY = [1,0,0, 0,1,0, 0,0,1];
// Orthonormal basis whose local Z axis follows dir (row-major 3x3).
export function basis(dir) {
  const f = dir, up = Math.abs(f[1]) > 0.95 ? [1,0,0] : [0,1,0];
  let r = [up[1]*f[2]-up[2]*f[1], up[2]*f[0]-up[0]*f[2], up[0]*f[1]-up[1]*f[0]];
  const l = Math.hypot(...r) || 1; r = r.map(v => v/l);
  const u = [f[1]*r[2]-f[2]*r[1], f[2]*r[0]-f[0]*r[2], f[0]*r[1]-f[1]*r[0]];
  return [r[0],u[0],f[0], r[1],u[1],f[1], r[2],u[2],f[2]];
}
export class Mesh {
  constructor(capacity = 32768) { this.data = new Float32Array(capacity); this.length = 0; }
  clear() { this.length = 0; return this; }
  reserve(count) {
    if (this.length + count <= this.data.length) return;
    let size = this.data.length; while (size < this.length + count) size *= 2;
    const next = new Float32Array(size); next.set(this.data); this.data = next;
  }
  vertex(p, n, c) { this.reserve(9); const d = this.data; let i = this.length; d[i++]=p[0]; d[i++]=p[1]; d[i++]=p[2]; d[i++]=n[0]; d[i++]=n[1]; d[i++]=n[2]; d[i++]=c[0]; d[i++]=c[1]; d[i++]=c[2]; this.length = i; }
  quad(a, b, c, d, n, color) { this.vertex(a,n,color); this.vertex(b,n,color); this.vertex(c,n,color); this.vertex(a,n,color); this.vertex(c,n,color); this.vertex(d,n,color); }
  box(x, y, z, w, h, depth, color) { this.obox(x, y, z, IDENTITY, w, h, depth, color); }
  // Box centred at (x,y,z) and oriented by a row-major rotation R.
  obox(x, y, z, R, w, h, depth, color) {
    this.reserve(324); const data = this.data; let j = this.length;
    for (let i = 0; i < CUBE.length; i += 6) {
      const a = CUBE[i]*w/2, b = CUBE[i+1]*h/2, c = CUBE[i+2]*depth/2, nx = CUBE[i+3], ny = CUBE[i+4], nz = CUBE[i+5];
      data[j++] = x + R[0]*a + R[1]*b + R[2]*c; data[j++] = y + R[3]*a + R[4]*b + R[5]*c; data[j++] = z + R[6]*a + R[7]*b + R[8]*c;
      data[j++] = R[0]*nx + R[1]*ny + R[2]*nz; data[j++] = R[3]*nx + R[4]*ny + R[5]*nz; data[j++] = R[6]*nx + R[7]*ny + R[8]*nz;
      data[j++] = color[0]; data[j++] = color[1]; data[j++] = color[2];
    }
    this.length = j;
  }
  // Streak between two points: a box oriented along the segment.
  streak(a, b, width, color) {
    const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], len = Math.hypot(...d);
    if (len < 1e-4) return;
    this.obox((a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2, basis(d.map(v => v/len)), width, width, len, color);
  }
  // Expanding air-ripple ring perpendicular to dir.
  ring(center, dir, radius, width, color, segments = 14) {
    const R = basis(dir), right = [R[0],R[3],R[6]], up = [R[1],R[4],R[7]];
    for (let i = 0; i < segments; i++) {
      const a = i/segments*Math.PI*2, b = (i+1)/segments*Math.PI*2;
      const p = (angle, r) => [0,1,2].map(k => center[k] + (right[k]*Math.cos(angle) + up[k]*Math.sin(angle))*r);
      this.quad(p(a, radius-width), p(b, radius-width), p(b, radius+width), p(a, radius+width), [0,1,0], color);
    }
  }
}
function shader(gl, type, source) {
  const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`Shader compilation failed: ${log}`); }
  return s;
}
const FOG = [0.08,0.08,0.1], SLOW_FOG = [0.17,0.14,0.11];
export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {antialias:true, alpha:false}) || canvas.getContext('webgl', {antialias:true, alpha:false});
    if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration or try a desktop browser with WebGL support.');
    this.gl = gl;
    const vs = shader(gl, gl.VERTEX_SHADER, VS), fs = shader(gl, gl.FRAGMENT_SHADER, FS), program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vs); gl.deleteShader(fs); gl.useProgram(program);
    this.attributes = ['aPosition','aNormal','aColor'].map(n => gl.getAttribLocation(program, n));
    this.u = Object.fromEntries(['VP','Eye','Mode','PointScale','Fog','Slow','Opacity','FogColor'].map(n => [n, gl.getUniformLocation(program, 'u'+n)]));
    this.dynamic = new Mesh(65536); this.glow = new Mesh(65536); this.points = new Mesh(8192); this.glassMesh = new Mesh(4096); this.weaponMesh = new Mesh();
    this.glassKey = ''; this.skins = {...DEFAULT_SKINS}; this.history = new WeakMap(); this.lastVP = null; this.camera = null;
    // Static level geometry is built once and uploaded once.
    const mesh = new Mesh(131072);
    for (const b of world.geometry) mesh.box(b.x, b.y, b.z, b.w, b.h, b.d, b.color);
    for (const b of world.solids) if (b.h < 3) mesh.box(b.x+0.5, 0.012, b.z+0.4, b.w+0.7, 0.01, b.d+0.7, [0.11,0.11,0.12]);
    this.staticBuffer = gl.createBuffer(); this.staticCount = mesh.length/9;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.data.subarray(0, mesh.length), gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    this.width = 0; this.height = 0;
  }
  setSkins(skins) { this.skins = normalizeSkins(skins); }
  resize(quality = 1) {
    const c = this.canvas, dpr = Math.min(devicePixelRatio || 1, quality === 0 ? 0.85 : 1.5);
    const w = Math.max(1, Math.round(c.clientWidth*dpr)), h = Math.max(1, Math.round(c.clientHeight*dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.gl.viewport(0, 0, w, h); this.width = w; this.height = h;
  }
  bind(buffer) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    this.attributes.forEach((a, i) => { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, i*12); });
  }
  drawMesh(mesh, points = false) {
    if (!mesh.length) return;
    const gl = this.gl; mesh.buffer ??= gl.createBuffer(); this.bind(mesh.buffer);
    if (!mesh.gpuCapacity || mesh.gpuCapacity < mesh.data.byteLength) { mesh.gpuCapacity = mesh.data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, mesh.gpuCapacity, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.data.subarray(0, mesh.length));
    gl.drawArrays(points ? gl.POINTS : gl.TRIANGLES, 0, mesh.length/9);
  }
  // Camera for the current state: first person, bullet cam, death fall or menu.
  cameraFor(game, effects, {menu, time, reduced}) {
    const p = game.player, kc = game.killcam;
    if (menu) {
      const t = time*0.06, eye = [Math.sin(t)*7, 3.1 + Math.sin(t*0.7)*0.4, 20 + Math.cos(t*0.8)*3];
      const a = aimAngles([-eye[0]*0.6, 1.4-eye[1], -12-eye[2]]);
      return {eye, yaw:a.yaw, pitch:a.pitch, roll:0, fov:64, mode:'menu'};
    }
    if (kc && kc.phase === 'flight') {
      const b = kc.bullet, d = b.dir, a = aimAngles(d);
      const side = basis(d);
      const eye = [0,1,2].map(i => b.pos[i] - d[i]*0.55 + side[i*3]*0.09 + side[i*3+1]*0.05);
      return {eye, yaw:a.yaw, pitch:a.pitch, roll:reduced ? 0 : kc.timer*0.35, fov:58, mode:'bullet'};
    }
    if (kc && kc.phase === 'impact' && kc.corpse) {
      const c = kc.corpse, d = kc.bullet.dir, center = [c.x, c.y + 1.0*(c.scale||1), c.z];
      const angle = Math.atan2(-d[0], -d[2]) + 0.7 + kc.timer*(reduced ? 0.15 : 0.45), r = 4.4;
      const eye = [clamp(center[0] + Math.sin(angle)*r, -21.4, 21.4), center[1] + 0.9 - kc.timer*0.12, clamp(center[2] + Math.cos(angle)*r, -31.4, 31.4)];
      const a = aimAngles(center.map((v,i) => v - eye[i]));
      return {eye, yaw:a.yaw, pitch:a.pitch, roll:0, fov:52, mode:'orbit'};
    }
    const w = game.weapon;
    const bob = game.moving && p.grounded && !reduced ? Math.sin(game.realTime*10.5)*0.03 : 0;
    let eye = [p.x, p.y + p.eye + bob, p.z], pitch = p.pitch + (reduced ? 0 : (w.recoil + Math.max(w.recoilL, w.recoilR)*0.5)*0.012), r = reduced ? 0 : p.roll;
    if (game.dying > 0) {
      const k = smooth(1 - game.dying/1.7);
      eye = [p.x, mix(p.y + p.eye, p.y + 0.25, k), p.z]; pitch = mix(p.pitch, 0.5, k); r = reduced ? 0 : mix(r, 1.1, k);
    }
    const fov = 80 - game.slow*5 + (reduced ? 0 : effects.fovKick || 0);
    return {eye, yaw:p.yaw + (reduced ? 0 : effects.shake*(Math.sin(time*91)*0.004)), pitch:pitch + (reduced ? 0 : effects.shake*Math.sin(time*77)*0.004), roll:r, fov, mode:'player'};
  }
  render(game, effects, opts = {}) {
    const {menu = false, time = 0, quality = 1, reduced = false} = opts;
    this.resize(quality);
    const gl = this.gl, cam = this.cameraFor(game, effects, {menu, time, reduced});
    this.camera = cam;
    const slow = menu ? 0 : reduced ? game.slow*0.5 : game.slow;
    const fog = FOG.map((v,i) => mix(v, SLOW_FOG[i], slow));
    gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const projection = perspective(cam.fov*Math.PI/180, this.width/this.height);
    const vp = multiply(projection, multiply(roll(cam.roll), view(cam.eye, cam.yaw, cam.pitch)));
    this.lastVP = vp;
    gl.uniformMatrix4fv(this.u.VP, false, vp); gl.uniform3fv(this.u.Eye, cam.eye); gl.uniform3fv(this.u.FogColor, fog);
    gl.uniform1f(this.u.Fog, 1); gl.uniform1f(this.u.Slow, slow); gl.uniform1f(this.u.Opacity, 1); gl.uniform1f(this.u.Mode, 0);
    this.bind(this.staticBuffer); gl.drawArrays(gl.TRIANGLES, 0, this.staticCount);
    // Lit dynamic geometry: enemies, corpses, glass shards.
    const dynamic = this.dynamic.clear(), glow = this.glow.clear();
    for (const b of game.bots) if (b.alive) this.figure(dynamic, glow, b, game, {});
    for (const c of game.corpses) this.figure(dynamic, glow, c, game, {corpse:true});
    for (const s of effects.shards) dynamic.obox(s.x, s.y, s.z, figureRotation(s.yaw, s.tilt), s.size, s.size*0.7, 0.012, s.color);
    for (const c of effects.casings) dynamic.obox(c.x, c.y, c.z, figureRotation(c.yaw, c.tilt), 0.011, 0.011, 0.026, [0.95,0.7,0.3]);
    this.drawMesh(dynamic);
    // Translucent intact glass.
    const key = game.glass.map(g => g.intact ? 1 : 0).join('');
    if (key !== this.glassKey) {
      this.glassKey = key; const m = this.glassMesh.clear();
      for (const g of game.glass) if (g.intact) m.box(g.x, g.y, g.z, g.w, g.h, g.d, [0.55,0.75,0.8]);
    }
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (this.glassMesh.length) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(this.u.Opacity, 0.2); this.drawMesh(this.glassMesh); gl.uniform1f(this.u.Opacity, 1); }
    // Additive glow: afterimages, bullets, air ripples, muzzle flashes.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    if (!menu && !reduced && game.slow > 0.25) this.afterimages(glow, game);
    this.trackHistory(game);
    for (const b of game.bullets) this.bullet(glow, b, game, cam);
    for (const r of effects.rings) {
      const k = clamp(r.life/r.max, 0, 1), c = r.enemy ? [0.5*k, 0.18*k, 0.08*k] : [0.16*k, 0.15*k, 0.12*k];
      glow.ring(r.pos, r.dir, r.radius, 0.006 + r.radius*0.05, c);
    }
    for (const f of effects.flashes) {
      const k = clamp(f.life/0.06, 0, 1), s = f.size*k;
      glow.box(f.pos[0], f.pos[1], f.pos[2], s, s*0.4, s*0.4, [1*k, 0.6*k, 0.25*k]);
      glow.box(f.pos[0], f.pos[1], f.pos[2], s*0.4, s, s*0.4, [1*k, 0.6*k, 0.25*k]);
    }
    if (glow.length) { gl.uniform1f(this.u.Mode, 2); this.drawMesh(glow); }
    if (effects.particles.length) {
      const dust = this.points.clear();
      for (const p of effects.particles) dust.vertex([p.x, p.y, p.z], [p.size, Math.min(1, p.life*2.5), 0], p.color);
      gl.uniform1f(this.u.Mode, 1); gl.uniform1f(this.u.PointScale, this.height/(2*Math.tan(cam.fov*Math.PI/360)));
      this.drawMesh(dust, true);
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(this.u.Mode, 0);
    if (cam.mode === 'player' && game.dying <= 0) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(this.u.VP, false, perspective(62*Math.PI/180, this.width/this.height, 0.02, 10));
      gl.uniform3fv(this.u.Eye, [0,0,0]); gl.uniform1f(this.u.Fog, 0);
      this.drawMesh(this.weapon(game, reduced));
    }
  }
  trackHistory(game) {
    for (const b of game.bots) {
      let h = this.history.get(b);
      if (!h) { h = []; this.history.set(b, h); }
      if (!h.length || game.realTime - h[h.length-1].t > 0.045) { h.push({t:game.realTime, x:b.x, y:b.y, z:b.z, yaw:b.yaw, phase:b.phase}); if (h.length > 6) h.shift(); }
    }
  }
  afterimages(glow, game) {
    for (const b of game.bots) {
      const h = this.history.get(b); if (!h) continue;
      for (let i = 0; i < h.length-1; i++) {
        const s = h[i], moved = Math.hypot(s.x-b.x, s.z-b.z);
        if (moved < 0.08) continue;
        const k = (i+1)/h.length*0.22*game.slow;
        this.figure(null, glow, {...b, x:s.x, y:s.y, z:s.z, yaw:s.yaw, phase:s.phase, charge:0, flash:0}, game, {ghost:[0.25*k, 0.55*k, 0.75*k]});
      }
    }
  }
  bullet(glow, b, game, cam) {
    const player = b.owner === 'player';
    const fade = player ? Math.max(0, 1 - b.traveled/5) : 0;
    const head = b.pos.map((v,i) => v + (player ? b.offset[i]*fade : 0));
    const length = Math.min(b.traveled + 0.05, player ? mix(1.2, 2.6, game.slow) : mix(0.8, 1.6, game.slow));
    const tail = b.pos.map((v,i) => v - b.dir[i]*length + (player ? b.offset[i]*Math.max(0, 1 - Math.max(0, b.traveled-length)/5) : 0));
    const bulletCam = cam.mode === 'bullet' && game.killcam?.bullet === b;
    if (bulletCam) {
      // The round itself, seen from just behind: a brass slug with a hot wake.
      const R = basis(b.dir);
      glow.obox(b.pos[0], b.pos[1], b.pos[2], R, 0.016, 0.016, 0.05, [0.9,0.65,0.3]);
      glow.streak(b.pos.map((v,i) => v - b.dir[i]*0.22), b.pos.map((v,i) => v - b.dir[i]*0.03), 0.004, [0.25,0.2,0.15]);
      return;
    }
    const core = player ? [1, 0.85, 0.5] : [1, 0.38, 0.14];
    glow.streak(tail, head, player ? 0.014 : 0.028, core);
    glow.streak(tail, head, player ? 0.045 : 0.075, player ? [0.18,0.14,0.08] : [0.3,0.09,0.03]);
  }
  // Voxel android: shared by live enemies, ragdoll corpses and afterimages.
  figure(mesh, glow, f, game, {corpse = false, ghost = null}) {
    const enemySkin = ENEMY_SKINS[this.skins.enemies] || ENEMY_SKINS.syndicate, look = enemySkin.looks[f.type] || enemySkin.looks.grunt, s = f.scale || 1;
    const sink = corpse && f.life < 1 ? (1 - f.life)*0.6 : 0;
    const lift = corpse ? Math.sin(f.tilt)*0.28*s : 0;
    const R = figureRotation(f.yaw, corpse ? f.tilt : 0, corpse ? f.lean : 0);
    const flash = !ghost && f.flash > 0, charge = !corpse && (f.charge > 0 || f.burst > 0);
    const target = ghost ? glow : mesh;
    const box = (x, y, z, w, h, d, color) => {
      x *= s; y *= s; z *= s;
      target.obox(f.x + R[0]*x + R[1]*y + R[2]*z, f.y - sink + lift + R[3]*x + R[4]*y + R[5]*z, f.z + R[6]*x + R[7]*y + R[8]*z, R, w*s, h*s, d*s, ghost || color);
    };
    const suit = flash ? [0.95,0.92,0.85] : look.suit, trim = look.trim;
    if (!corpse && !ghost) mesh.box(f.x, 0.02, f.z, 0.9*s, 0.02, 0.7*s, [0.05,0.05,0.06]);
    const gait = corpse ? 0.15 : Math.sin(f.phase*9)*0.12;
    box(-0.2, 0.37, gait, 0.26, 0.74, 0.3, trim); box(0.2, 0.37, -gait, 0.26, 0.74, 0.3, trim);
    box(-0.2, 0.06, gait-0.06, 0.3, 0.12, 0.42, [0.04,0.04,0.05]); box(0.2, 0.06, -gait-0.06, 0.3, 0.12, 0.42, [0.04,0.04,0.05]);
    box(0, 1.19, 0, 0.78, 0.98, 0.5, suit);
    box(0, 0.78, 0.02, 0.84, 0.32, 0.56, suit); // coat tails
    box(0, 1.45, -0.26, 0.2, 0.42, 0.03, look.shirt); box(0, 1.42, -0.28, 0.07, 0.34, 0.02, look.tie); // shirt and tie
    this.enemyDetail(box, enemySkin.detail, look, f, corpse);
    if (f.type === 'heavy') { box(-0.5, 1.6, 0, 0.36, 0.22, 0.6, trim); box(0.5, 1.6, 0, 0.36, 0.22, 0.6, trim); box(0, 1.2, -0.29, 0.6, 0.6, 0.06, look.shirt); }
    box(-0.5, 1.17, 0, 0.24, 0.72, 0.34, suit); box(0.5, 1.17, -0.18, 0.24, 0.72, 0.34, suit);
    box(-0.5, 0.76, 0, 0.2, 0.16, 0.2, look.skin);
    if (!(corpse && f.head)) {
      box(0, 1.93, 0, 0.5, 0.52, 0.5, look.skin); box(0, 2.2, 0.03, 0.54, 0.1, 0.54, trim);
      const visor = charge ? [1.6,0.3,0.12] : look.visor;
      box(0, 1.97, -0.26, 0.46, 0.11, 0.04, visor);
    } else box(0, 1.75, 0, 0.34, 0.12, 0.34, [0.15,0.15,0.15]);
    // Weapon in the right hand.
    if (!corpse) {
      const heavy = f.type === 'heavy';
      box(0.5, 1.12, -0.45, 0.13, 0.17, heavy ? 0.9 : f.type === 'runner' ? 0.62 : 0.42, [0.06,0.06,0.07]);
      if (charge && !ghost) {
        const k = f.burst > 0 ? 1 : clamp(f.charge/0.6, 0, 1), size = 0.06 + k*0.12, m = [0,1,2].map(i => 0);
        const x = 0.5*s, y = 1.14*s, z = -(heavy ? 0.95 : 0.8)*s;
        m[0] = f.x + R[0]*x + R[2]*z; m[1] = f.y + R[4]*y; m[2] = f.z + R[6]*x + R[8]*z;
        glow.box(m[0], m[1], m[2], size, size, size, [0.9*k, 0.25*k, 0.08*k]);
      }
    }
    if (!corpse && !ghost && f.spawnFx > 0) {
      const k = f.spawnFx/0.6; glow.box(f.x, 1.2*s, f.z, 1.2*k, 2.6, 1.2*k, [0.1*k, 0.35*k, 0.4*k]);
    }
  }
  // Enemy skin details layered over the base figure.
  enemyDetail(box, detail, look, f, corpse) {
    if (detail === 'pinstripe') {
      for (const x of [-0.3, -0.18, 0.18, 0.3]) box(x, 1.12, -0.258, 0.012, 0.8, 0.01, look.shirt);
      box(0, 1.98, -0.262, 0.42, 0.24, 0.02, look.skin); // porcelain mask
      box(-0.11, 2.0, -0.275, 0.09, 0.04, 0.01, look.visor); box(0.11, 2.0, -0.275, 0.09, 0.04, 0.01, look.visor);
    } else if (detail === 'plates') {
      for (const y of [0.95, 1.15, 1.35]) box(0, y, -0.258, 0.6, 0.07, 0.01, look.trim);
      box(-0.5, 1.5, 0, 0.27, 0.06, 0.37, look.trim); box(0.5, 1.5, -0.18, 0.27, 0.06, 0.37, look.trim);
      if (!(corpse && f.head)) box(0, 2.27, 0.03, 0.4, 0.02, 0.4, look.visor);
    } else if (detail === 'armor') {
      box(0, 1.3, -0.27, 0.66, 0.5, 0.06, look.trim); box(0, 1.3, -0.305, 0.12, 0.3, 0.01, look.tie);
      box(-0.5, 1.5, 0, 0.32, 0.18, 0.42, look.trim); box(0.5, 1.5, -0.18, 0.32, 0.18, 0.42, look.trim);
      box(-0.2, 0.42, -0.17, 0.24, 0.16, 0.06, look.trim); box(0.2, 0.42, -0.17, 0.24, 0.16, 0.06, look.trim);
      if (!(corpse && f.head)) box(0, 2.14, 0.02, 0.58, 0.22, 0.58, look.trim);
    }
  }
  weapon(game, reduced) {
    const mesh = this.weaponMesh.clear(), w = game.weapon, p = game.player, def = game.weaponDef;
    const sway = game.moving && !reduced ? Math.sin(game.realTime*10.5)*0.012 : 0;
    const reloadT = w.reload > 0 ? Math.sin((1 - w.reload/def.reload)*Math.PI) : 0;
    const switchT = w.switching/0.3;
    const dive = p.diving || p.prone > 0 ? 1 : 0;
    const dy = -sway - reloadT*0.28 - switchT*0.45 - dive*0.02, dx = dive*p.diveSide*0.03;
    const finish = WEAPON_SKINS[this.skins[def.id]] || WEAPON_SKINS.factory;
    const {metal, edge, grip} = finish, sleeve = [0.1,0.085,0.08], skin = [0.6,0.45,0.35], sight = [1.3,1.2,0.9];
    // Parts are placed in the gun's own frame, then turned slightly toward the crosshair.
    const gun = (ox, oy, oz, yaw, pitch) => {
      const R = figureRotation(yaw, pitch);
      const part = (x, y, z, w, h, d, color) => mesh.obox(ox + R[0]*x + R[1]*y + R[2]*z, oy + R[3]*x + R[4]*y + R[5]*z, oz + R[6]*x + R[7]*y + R[8]*z, R, w, h, d, color);
      // A skinned panel: the base box plus the skin's surface pattern.
      part.panel = (x, y, z, w, h, d, color) => { part(x, y, z, w, h, d, color); weaponPattern(finish.pattern, [x, y, z, w, h, d], finish.accent, part); };
      return part;
    };
    const flash = (part, z, k) => { if (k > 0.6 && !reduced) { part(0, 0.012, z, 0.07*k, 0.07*k, 0.12, [1.6,1.25,0.6]); part(0, 0.012, z - 0.02, 0.14*k, 0.02, 0.02, [1.6,1.1,0.5]); } };
    if (def.id === 'duals') {
      for (const side of [-1, 1]) {
        const r = side > 0 ? w.recoilR : w.recoilL, idle = side < 0 ? Math.sin(game.realTime*1.3)*0.003 : 0;
        const part = gun(side*0.155 + dx, -0.15 + dy + r*0.02 + idle, -0.6 + r*0.05, side*0.07, r*0.22);
        part.panel(0, 0.02, 0, 0.034, 0.03, 0.19, edge);      // slide
        part(0, -0.002, 0.005, 0.03, 0.025, 0.17, metal);     // frame
        part.panel(0, -0.055, 0.06, 0.028, 0.085, 0.04, grip); // grip
        part(0, 0.04, -0.085, 0.006, 0.01, 0.008, sight);      // front sight
        part(0, -0.06, 0.075, 0.05, 0.05, 0.06, skin);         // hand
        part(side*0.012, -0.1, 0.2, 0.075, 0.08, 0.22, sleeve); // forearm
        flash(part, -0.13, r);
      }
    } else if (def.id === 'shotgun') {
      const r = w.recoil, pump = w.cooldown > 0 ? Math.sin(clamp(1 - w.cooldown/def.cycle, 0, 1)*Math.PI)*0.09 : 0;
      const part = gun(0.15 + dx, -0.16 + dy + r*0.03, -0.62 + r*0.08, 0.05, r*0.3);
      part.panel(0, 0, 0.05, 0.05, 0.065, 0.28, metal);      // receiver
      part.panel(0, 0.018, -0.33, 0.026, 0.026, 0.46, edge); // barrel
      part(0, -0.012, -0.29, 0.022, 0.022, 0.4, metal);      // magazine tube
      part(0, -0.018, -0.2 + pump, 0.048, 0.042, 0.15, grip); // pump
      part.panel(0, -0.03, 0.27, 0.045, 0.085, 0.2, grip);   // stock
      part(0, 0.036, -0.54, 0.008, 0.008, 0.008, sight);
      part(-0.01, -0.06, -0.2 + pump, 0.055, 0.05, 0.07, skin); part(-0.05, -0.12, -0.02 + pump*0.5, 0.075, 0.075, 0.26, sleeve);
      part(0.01, -0.06, 0.16, 0.05, 0.05, 0.06, skin); part(0.03, -0.12, 0.33, 0.075, 0.08, 0.22, sleeve);
      flash(part, -0.6, r);
    } else {
      const r = w.recoil, shake = reduced ? 0 : Math.sin(game.realTime*60)*r*0.003;
      const part = gun(0.15 + dx + shake, -0.155 + dy + r*0.012, -0.6 + r*0.04, 0.05, r*0.08);
      part.panel(0, 0, 0, 0.045, 0.065, 0.28, metal);        // receiver
      part(0, 0.01, -0.24, 0.022, 0.022, 0.2, edge);         // barrel
      part(0, -0.012, -0.18, 0.04, 0.04, 0.14, grip);        // handguard
      part(0, -0.075, -0.03, 0.03, 0.09, 0.05, edge);        // magazine
      part.panel(0, -0.012, 0.22, 0.038, 0.075, 0.17, metal); // stock
      part(0, 0.05, 0, 0.03, 0.03, 0.12, metal);             // optic
      part(0, 0.05, -0.061, 0.022, 0.014, 0.004, [1.2,0.3,0.15]);
      part(-0.01, -0.05, -0.17, 0.05, 0.05, 0.07, skin); part(-0.05, -0.11, 0, 0.075, 0.075, 0.24, sleeve);
      part(0.01, -0.06, 0.1, 0.05, 0.05, 0.06, skin); part(0.03, -0.12, 0.27, 0.075, 0.08, 0.22, sleeve);
      flash(part, -0.36, r);
    }
    return mesh;
  }
  project(point) {
    if (!this.lastVP) return null; const p = transform(this.lastVP, point);
    if (p[3] <= 0) return null;
    return [(p[0]/p[3]*0.5 + 0.5)*this.canvas.clientWidth, (-p[1]/p[3]*0.5 + 0.5)*this.canvas.clientHeight];
  }
}
