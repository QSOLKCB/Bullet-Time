// Renders the skin swatch assets in assets/skins/ from src/skins.js, so the
// menu previews always match the in-game palettes. Run: npm run skins
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {WEAPON_SKINS, ENEMY_SKINS} from '../src/skins.js';
const out = new URL('../assets/skins/', import.meta.url);
const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v))*255).toString(16).padStart(2, '0')).join('');
const xml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const glow = c => c[0] + c[1] + c[2] > 2.6;
const shade = (c, k) => c.map(v => Math.min(1, v)*k);

function weaponSvg(id, s) {
  const accent = hex(s.accent), filter = glow(s.accent) ? ' filter="url(#g)"' : '';
  const slide = {x:14, y:20, w:74, h:15}, grip = 'M30 37 L48 37 L44 70 L24 70 Z';
  let pattern = '';
  switch (s.pattern) {
    case 'engrave': pattern = `<path d="M18 24 H84 M18 31 H84" stroke="${accent}" stroke-width="1.2"/><g fill="none" stroke="${accent}" stroke-width="1"><circle cx="34" cy="27.5" r="2.6"/><circle cx="51" cy="27.5" r="2.6"/><circle cx="68" cy="27.5" r="2.6"/></g><path d="M29 46 L42 46 M28 54 L41 54 M27 62 L40 62" stroke="${accent}" stroke-width="1"/>`; break;
    case 'inlay': pattern = `<path d="M17 27.5 H85" stroke="${accent}" stroke-width="2"${filter}/><circle cx="36" cy="52" r="2.4" fill="${accent}"${filter}/>`; break;
    case 'stripe': pattern = `<rect x="14" y="20" width="74" height="4.5" fill="${accent}"/>`; break;
    case 'bands': pattern = [26, 51, 76].map(x => `<rect x="${x - 2}" y="19" width="4" height="17" fill="${accent}"/>`).join(''); break;
    case 'tiger': pattern = [22, 34, 46, 58, 70, 82].map((x, i) => `<path d="M${x} 20 L${x + 5} 20 L${x - 1} 35 L${x - 6} 35 Z" fill="${accent}"/>`).join('') + `<path d="M28 44 L42 41 L41 46 L27 49 Z M26 58 L40 55 L39 60 L25 63 Z" fill="${accent}"/>`; break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" role="img" aria-label="${xml(s.name)} weapon skin">
<defs><filter id="g" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(s.edge)}"/><stop offset="1" stop-color="${hex(shade(s.edge, 0.7))}"/></linearGradient></defs>
<rect width="100" height="80" rx="6" fill="#15110f"/>
<path d="${grip}" fill="${hex(s.grip)}"/>
<rect x="22" y="34" width="56" height="7" fill="${hex(s.metal)}"/>
<path d="M48 41 Q52 52 60 41" fill="none" stroke="${hex(s.metal)}" stroke-width="2.5"/>
<rect x="${slide.x}" y="${slide.y}" width="${slide.w}" height="${slide.h}" rx="1.5" fill="url(#m)"/>
<rect x="88" y="23" width="6" height="7" fill="${hex(shade(s.metal, 0.8))}"/>
${pattern}
<rect x="82" y="17.5" width="3" height="3" fill="#ffe9b0"/>
</svg>
`;
}

function figure(x, scale, l, detail) {
  const t = (px, py) => `${(x + px*scale).toFixed(1)} ${(78 - py*scale).toFixed(1)}`;
  const r = (px, py, w, h, c, extra = '') => `<rect x="${(x + (px - w/2)*scale).toFixed(1)}" y="${(78 - (py + h/2)*scale).toFixed(1)}" width="${(w*scale).toFixed(1)}" height="${(h*scale).toFixed(1)}" fill="${hex(c)}"${extra}/>`;
  const glowAttr = glow(l.visor) ? ' filter="url(#g)"' : '';
  let parts = [
    r(-5, 9, 6, 18, l.trim), r(5, 9, 6, 18, l.trim),
    r(0, 29, 20, 25, l.suit), r(0, 19, 21, 8, l.suit),
    r(-12.5, 29, 6, 18, l.suit), r(12.5, 29, 6, 18, l.suit),
    r(0, 36, 5, 10, l.shirt), r(0, 35, 1.8, 8, l.tie),
    r(0, 48, 13, 13, l.skin), r(0, 55, 14, 2.5, l.trim),
    r(0, 49, 11.5, 2.8, l.visor, glowAttr)
  ];
  if (detail === 'pinstripe') parts.push(r(-7.5, 28, 0.4, 20, l.shirt), r(-4.5, 28, 0.4, 20, l.shirt), r(4.5, 28, 0.4, 20, l.shirt), r(7.5, 28, 0.4, 20, l.shirt));
  if (detail === 'plates') parts.push(r(0, 23, 15, 1.6, l.trim), r(0, 28, 15, 1.6, l.trim), r(0, 33, 15, 1.6, l.trim), r(0, 57.5, 10, 0.8, l.visor, glowAttr));
  if (detail === 'armor') parts.push(r(0, 32, 16, 12, l.trim), r(0, 32, 3, 7, l.tie), r(-12.5, 37, 8, 4.5, l.trim), r(12.5, 37, 8, 4.5, l.trim), r(0, 53.5, 14.5, 5.5, l.trim));
  return parts.join('') + `<path d="M${t(12.5, 22)} L${t(12.5, 26)}" stroke="#000" stroke-width="${2*scale}"/>`;
}
function enemySvg(id, s) {
  const {grunt, runner, heavy} = s.looks;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" role="img" aria-label="${xml(s.name)} enemy skin">
<defs><filter id="g" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="0.9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="100" height="80" rx="6" fill="#15110f"/>
<rect x="0" y="74" width="100" height="6" fill="#0c0a09"/>
${figure(22, 0.62, runner, s.detail)}${figure(78, 0.74, heavy, s.detail)}${figure(50, 0.86, grunt, s.detail)}
</svg>
`;
}

await mkdir(out, {recursive:true});
const written = [];
for (const [id, s] of Object.entries(WEAPON_SKINS)) { const name = `weapon-${id}.svg`; await writeFile(new URL(name, out), weaponSvg(id, s)); written.push(name); }
for (const [id, s] of Object.entries(ENEMY_SKINS)) { const name = `enemy-${id}.svg`; await writeFile(new URL(name, out), enemySvg(id, s)); written.push(name); }
// Keep the offline cache list in sync with the generated assets.
const swUrl = new URL('../sw.js', import.meta.url), sw = await readFile(swUrl, 'utf8');
const list = written.map(n => `'./assets/skins/${n}'`).join(',');
await writeFile(swUrl, sw.replace(/const SKIN_FILES = \[[^\]]*\];/, `const SKIN_FILES = [${list}];`));
console.log(`Wrote ${written.length} skin swatches to assets/skins/.`);
