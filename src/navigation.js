import {rayBox} from './math.js';

// One shared flow field for every enemy (adapted from QSOLKCB/QUICKSCOPER).
// Recomputed only when the player changes grid cells; typed scratch arrays are
// reused (OPT-INV-001 invariant-driven reuse). Cardinal routes never cut corners.
// Glass is deliberately absent: enemies smash through intact panes.
export class Navigation {
  constructor(solids, bounds, cell = 2) {
    this.solids = solids; this.cellSize = cell;
    this.minX = bounds.minX + 1; this.minZ = bounds.minZ + 1;
    this.width = Math.floor((bounds.maxX - bounds.minX - 2) / cell) + 1;
    this.height = Math.floor((bounds.maxZ - bounds.minZ - 2) / cell) + 1;
    this.target = -1;
    const size = this.width * this.height;
    this.open = new Uint8Array(size); this.distance = new Int16Array(size); this.queue = new Int16Array(size);
    for (let i = 0; i < size; i++) {
      const [x, z] = this.point(i);
      this.open[i] = !solids.some(b => b.min[1] < 2.2 && b.max[1] > 0.01 && x+0.5 > b.min[0] && x-0.5 < b.max[0] && z+0.5 > b.min[2] && z-0.5 < b.max[2]);
    }
    // Precompute safe cardinal edges once. The swept rectangle includes body
    // clearance, so thin cover between otherwise clear centres blocks a link.
    this.routes = Array.from({length:size}, (_, i) => {
      if (!this.open[i]) return [];
      const [x, z] = this.point(i);
      return this.adjacent(i).filter(n => {
        if (n < 0 || n >= size || !this.open[n]) return false;
        const [nx, nz] = this.point(n);
        return !solids.some(b => b.min[1] < 2.2 && b.max[1] > 0.01 &&
          Math.max(x, nx)+0.5 > b.min[0] && Math.min(x, nx)-0.5 < b.max[0] &&
          Math.max(z, nz)+0.5 > b.min[2] && Math.min(z, nz)-0.5 < b.max[2]);
      });
    });
  }
  point(i) { return [this.minX + (i % this.width) * this.cellSize, this.minZ + Math.floor(i / this.width) * this.cellSize]; }
  cell(x, z) {
    const cx = Math.max(0, Math.min(this.width-1, Math.round((x - this.minX) / this.cellSize)));
    const cz = Math.max(0, Math.min(this.height-1, Math.round((z - this.minZ) / this.cellSize)));
    return cz * this.width + cx;
  }
  adjacent(i) { const x = i % this.width; return [x ? i-1 : -1, x < this.width-1 ? i+1 : -1, i-this.width, i+this.width]; }
  neighbors(i) { return this.routes[i]; }
  recover(x, z) {
    let best = -1, nearest = Infinity;
    const origin = [x, 0, z];
    for (let i = 0; i < this.open.length; i++) if (this.open[i] && this.distance[i] >= 0) {
      const [nx, nz] = this.point(i), d = (nx-x)**2 + (nz-z)**2;
      if (d >= nearest) continue;
      // Sweep from the actual body position, not the obstructed grid centre.
      // Recovery uses the enemy collision radius; grid edges reserve 0.5 m.
      const direction = [nx-x, 0, nz-z];
      const blocked = this.solids.some(b => b.min[1] < 2.2 && b.max[1] > 0.01 && rayBox(origin, direction, {
        min:[b.min[0]-0.42, b.min[1]-2.2, b.min[2]-0.42],
        max:[b.max[0]+0.42, b.max[1], b.max[2]+0.42]
      }, 1) !== null);
      if (!blocked) { best = i; nearest = d; }
    }
    return best < 0 ? [x, z] : this.point(best);
  }
  toward(x, z, px, pz) {
    let target = this.cell(px, pz);
    if (!this.open[target]) {
      let best = Infinity;
      for (let i = 0; i < this.open.length; i++) if (this.open[i]) { const p = this.point(i), d = (p[0]-px)**2 + (p[1]-pz)**2; if (d < best) { best = d; target = i; } }
    }
    if (target !== this.target) {
      this.target = target; this.distance.fill(-1);
      let head = 0, tail = 1; this.queue[0] = target; this.distance[target] = 0;
      while (head < tail) {
        const i = this.queue[head++];
        for (const n of this.neighbors(i)) if (n >= 0 && n < this.open.length && this.open[n] && this.distance[n] < 0) { this.distance[n] = this.distance[i] + 1; this.queue[tail++] = n; }
      }
    }
    const cell = this.cell(x, z);
    if (!this.open[cell]) return this.recover(x, z);
    let best = cell, value = this.distance[cell] < 0 ? 32767 : this.distance[cell];
    for (const n of this.neighbors(cell)) if (n >= 0 && n < this.open.length && this.distance[n] >= 0 && this.distance[n] < value) { best = n; value = this.distance[n]; }
    return this.point(best);
  }
}
