import {boxAt} from './math.js';
// TERMINAL NINE: an original abandoned transit concourse. Two colonnades of
// pillars, glass partitions to dive through, low benches and kiosks for cover.
// Colours whose RGB sum exceeds 2.6 are rendered as emissive light sources.
export const PALETTE = {
  floor:[0.20,0.19,0.19], tile:[0.25,0.24,0.23], marble:[0.56,0.53,0.49], trim:[0.17,0.16,0.17],
  wall:[0.31,0.30,0.31], dark:[0.09,0.09,0.11], brass:[0.62,0.47,0.22], green:[0.16,0.33,0.24],
  wood:[0.36,0.24,0.16], steel:[0.33,0.37,0.40], red:[0.55,0.15,0.12],
  lamp:[1.55,1.38,1.05], sign:[0.25,1.35,1.10], warn:[1.5,0.55,0.25]
};
export const BOUNDS = Object.freeze({minX:-22, maxX:22, minZ:-32, maxZ:32, ceiling:8});
export function makeWorld() {
  const geometry = [], solids = [], glass = [];
  const add = (x,y,z,w,h,d,color,solid=false) => {
    const b = {x,y,z,w,h,d,color,...boxAt(x,y,z,w,h,d)};
    geometry.push(b); if (solid) solids.push(b); return b;
  };
  const pane = (x,y,z,w,h,d) => { glass.push({x,y,z,w,h,d,...boxAt(x,y,z,w,h,d)}); };
  const p = PALETTE;
  // Shell: floor, ceiling, walls.
  add(0,-0.25,0,46,0.5,66,p.floor);
  for (let x=-20; x<=20; x+=4) add(x,0.004,0,0.06,0.01,64,p.tile);
  for (let z=-30; z<=30; z+=4) add(0,0.005,z,44,0.01,0.06,p.tile);
  add(0,8.25,0,46,0.5,66,p.dark);
  add(-22.5,4,0,1,8,66,p.wall,true); add(22.5,4,0,1,8,66,p.wall,true);
  add(0,4,-32.5,46,8,1,p.wall,true); add(0,4,32.5,46,8,1,p.wall,true);
  for (const x of [-21.95,21.95]) { add(x,0.4,0,0.1,0.8,64,p.trim); add(x,6.2,0,0.12,0.25,64,p.brass); }
  for (const z of [-31.95,31.95]) { add(0,0.4,z,44,0.8,0.1,p.trim); add(0,6.2,z,44,0.25,0.12,p.brass); }
  // Ceiling light strips and coffers.
  for (const x of [-15,-4.5,4.5,15]) add(x,7.96,0,0.45,0.08,60,p.lamp);
  for (let z=-28; z<=28; z+=8) add(0,7.9,z,44,0.22,0.5,p.trim);
  // Colonnades.
  for (const x of [-9,9]) for (let z=-24; z<=24; z+=8) {
    add(x,4,z,1.4,8,1.4,p.marble,true);
    add(x,0.25,z,1.75,0.5,1.75,p.trim); add(x,7.6,z,1.8,0.5,1.8,p.trim);
    add(x,2.4,z,1.46,0.12,1.46,p.brass);
  }
  // Glass partitions between the central pillars of each colonnade, plus two screens.
  for (const x of [-9,9]) { pane(x,1.45,-4,0.08,2.9,6.6); pane(x,1.45,4,0.08,2.9,6.6); add(x,2.95,0,0.16,0.1,16,p.trim); }
  pane(0,1.45,-11,5.2,2.9,0.08); pane(0,1.45,11,5.2,2.9,0.08);
  for (const z of [-11,11]) { add(-2.7,1.45,z,0.14,2.9,0.16,p.trim); add(2.7,1.45,z,0.14,2.9,0.16,p.trim); add(0,2.95,z,5.5,0.1,0.16,p.trim); }
  // Central planter with a dead garden.
  add(0,0.45,0,3,0.9,8,p.marble,true); add(0,0.93,0,2.6,0.08,7.6,[0.18,0.14,0.11]);
  for (const z of [-2.8,-0.9,1,2.8]) { add(0,1.4,z,0.12,1,0.12,p.wood); add(0,2.05,z,0.9,0.6,0.9,p.green); }
  // Benches (low cover: crouch behind them).
  const bench = (x,z) => { add(x,0.32,z,0.75,0.64,3,p.wood,true); add(x,0.12,z-1.2,0.6,0.24,0.12,p.steel); add(x,0.12,z+1.2,0.6,0.24,0.12,p.steel); };
  bench(-4.5,-17); bench(4.5,-17); bench(-4.5,17); bench(4.5,17); bench(-15,0); bench(15,0);
  // Information kiosks.
  for (const z of [-21,21]) {
    add(0,1.2,z,2.4,2.4,2.4,p.steel,true); add(0,2.5,z,2.6,0.2,2.6,p.trim);
    add(0,1.7,z-1.22,1.8,0.7,0.04,p.sign); add(0,1.7,z+1.22,1.8,0.7,0.04,p.sign);
  }
  // Ticket booths in the corners.
  for (const x of [-17.5,17.5]) for (const z of [-25,25]) {
    add(x,1.3,z,5,2.6,4,p.wood,true); add(x,2.7,z,5.3,0.2,4.3,p.trim);
    add(x,3.3,z,3.5,0.6,0.1,p.red); add(x,1.05,z+(z<0?2.02:-2.02),4,0.08,0.06,p.brass);
  }
  // Luggage carts, barriers and crates.
  const barrier = (x,z,w=3,d=1) => { add(x,0.6,z,w,1.2,d,p.steel,true); add(x,1.23,z,w+0.06,0.06,d+0.06,p.warn); };
  barrier(-15,-10); barrier(15,10); barrier(-15,12,1,3); barrier(15,-12,1,3); barrier(-3,26,3,1); barrier(3,-26,3,1);
  const crate = (x,z,s=1.4) => { add(x,s/2,z,s,s,s,[0.38,0.31,0.21],true); add(x,s/2,z+s/2+0.01,s*0.9,0.12,0.03,p.trim); };
  crate(-19.5,-14); crate(-19.5,-12.5); crate(19.5,14); crate(19.5,15.5); crate(-12.5,26); crate(12.5,-6.5,1.2);
  // Doorways and exit signs on the end walls (decorative recesses).
  for (const z of [-31.9,31.9]) for (const x of [-16,0,16]) {
    add(x,1.6,z,3,3.2,0.14,p.dark); add(x,3.6,z+(z<0?0.1:-0.1),1.3,0.36,0.06,p.sign);
  }
  // Side-wall advertising panels.
  for (const x of [-21.9,21.9]) for (const z of [-18,-6,6,18]) add(x,3.6,z,0.08,2.2,5,z%12===0?[1.0,0.62,0.95]:[0.95,0.85,0.55]);
  return {
    geometry, solids, glass, bounds: BOUNDS,
    start: [-5.5, 8],
    spawns: [[0,-29],[-16,-29],[16,-29],[0,29],[-16,29],[16,29],[-20,-6],[20,6],[-20,19],[20,-19],[-13,-29],[13,29]]
  };
}
