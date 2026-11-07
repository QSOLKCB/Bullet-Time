// Skin assets for weapons and enemies. All original, data-driven and procedural:
// each skin is a palette plus a surface pattern that the renderer turns into
// extra geometry (engraving, inlay, bands, stripes, armour plates). Colours whose
// RGB sum exceeds 2.6 render as emissive (glowing) in the world shader.
// scripts/skins.mjs renders the matching SVG swatches in assets/skins/.

export const WEAPON_SKINS = Object.freeze({
  factory:{name:'FACTORY', note:'Parkerized gunmetal and walnut.', metal:[0.1,0.1,0.11], edge:[0.3,0.3,0.32], grip:[0.22,0.14,0.09], accent:[0.42,0.42,0.44], pattern:'none'},
  ivory:{name:'IVORY & BRASS', note:'Engraved brass with ivory grips.', metal:[0.6,0.46,0.2], edge:[0.78,0.66,0.38], grip:[0.86,0.82,0.72], accent:[0.32,0.22,0.08], pattern:'engrave'},
  ember:{name:'EMBER', note:'Blackened steel, molten inlay.', metal:[0.055,0.05,0.05], edge:[0.13,0.12,0.11], grip:[0.09,0.07,0.06], accent:[1.7,0.62,0.18], pattern:'inlay'},
  chrome:{name:'CHROME NOIR', note:'Mirror chrome, a racing stripe.', metal:[0.62,0.65,0.7], edge:[0.86,0.88,0.92], grip:[0.07,0.07,0.08], accent:[0.08,0.08,0.09], pattern:'stripe'},
  jade:{name:'JADE', note:'Lacquered green with gilt bands.', metal:[0.1,0.3,0.22], edge:[0.24,0.5,0.38], grip:[0.08,0.09,0.08], accent:[0.9,0.72,0.3], pattern:'bands'},
  tiger:{name:'TIGER STRIPE', note:'Hand-painted hazard stripes.', metal:[0.82,0.44,0.1], edge:[0.92,0.6,0.2], grip:[0.1,0.08,0.07], accent:[0.06,0.05,0.04], pattern:'tiger'}
});
export const WEAPON_SKIN_IDS = Object.freeze(Object.keys(WEAPON_SKINS));

const look = (suit, trim, skin, visor, shirt, tie) => ({suit, trim, skin, visor, shirt, tie});
export const ENEMY_SKINS = Object.freeze({
  syndicate:{name:'SYNDICATE', note:'Charcoal suits, amber visors.', detail:'none', looks:{
    grunt:look([0.16,0.17,0.2],[0.07,0.07,0.08],[0.6,0.56,0.5],[0.85,0.55,0.25],[0.85,0.85,0.82],[0.07,0.07,0.08]),
    runner:look([0.46,0.15,0.13],[0.12,0.07,0.07],[0.55,0.5,0.46],[0.3,0.75,0.85],[0.85,0.85,0.82],[0.12,0.07,0.07]),
    heavy:look([0.3,0.32,0.22],[0.12,0.13,0.1],[0.5,0.48,0.42],[0.95,0.8,0.3],[0.22,0.24,0.18],[0.12,0.13,0.1])}},
  chrome:{name:'CHROME AGENTS', note:'Polished androids, glowing eyes.', detail:'plates', looks:{
    grunt:look([0.6,0.63,0.67],[0.2,0.21,0.24],[0.75,0.77,0.8],[0.3,1.3,1.4],[0.3,0.32,0.36],[0.2,0.21,0.24]),
    runner:look([0.7,0.62,0.45],[0.25,0.2,0.12],[0.8,0.74,0.62],[1.4,1.2,0.3],[0.3,0.26,0.2],[0.25,0.2,0.12]),
    heavy:look([0.42,0.44,0.5],[0.14,0.15,0.18],[0.6,0.62,0.66],[1.5,0.4,1.2],[0.2,0.21,0.24],[0.14,0.15,0.18])}},
  nightshift:{name:'NIGHT SHIFT', note:'Riot armour, red optics.', detail:'armor', looks:{
    grunt:look([0.08,0.085,0.1],[0.03,0.03,0.035],[0.12,0.12,0.13],[1.6,0.2,0.15],[0.18,0.19,0.22],[0.6,0.12,0.1]),
    runner:look([0.12,0.14,0.18],[0.04,0.05,0.06],[0.14,0.15,0.17],[1.6,0.25,0.2],[0.22,0.25,0.3],[0.7,0.6,0.15]),
    heavy:look([0.16,0.16,0.15],[0.05,0.05,0.05],[0.13,0.13,0.13],[1.7,0.3,0.1],[0.3,0.28,0.24],[0.7,0.15,0.1])}},
  masquerade:{name:'MASQUERADE', note:'Pinstripe suits and porcelain masks.', detail:'pinstripe', looks:{
    grunt:look([0.24,0.1,0.3],[0.08,0.04,0.1],[0.92,0.9,0.86],[0.08,0.06,0.08],[0.9,0.78,0.4],[0.08,0.04,0.1]),
    runner:look([0.1,0.22,0.3],[0.04,0.08,0.1],[0.92,0.9,0.86],[0.08,0.06,0.08],[0.9,0.78,0.4],[0.5,0.1,0.12]),
    heavy:look([0.34,0.08,0.1],[0.1,0.03,0.04],[0.92,0.9,0.86],[0.08,0.06,0.08],[0.9,0.78,0.4],[0.08,0.04,0.1])}}
});
export const ENEMY_SKIN_IDS = Object.freeze(Object.keys(ENEMY_SKINS));
export const DEFAULT_SKINS = Object.freeze({duals:'factory', shotgun:'factory', carbine:'factory', enemies:'syndicate'});

// Validates stored choices, falling back to defaults for anything unknown.
export function normalizeSkins(value) {
  const out = {...DEFAULT_SKINS};
  if (!value || typeof value !== 'object') return out;
  for (const key of ['duals','shotgun','carbine']) if (Object.hasOwn(WEAPON_SKINS, value[key])) out[key] = value[key];
  if (Object.hasOwn(ENEMY_SKINS, value.enemies)) out.enemies = value.enemies;
  return out;
}

// Pattern decoration for one weapon panel (a box in the gun's local frame,
// length along Z). Calls draw(x, y, z, w, h, d, color) for each decal box.
export function weaponPattern(pattern, panel, accent, draw) {
  const [x, y, z, w, h, d] = panel, e = 0.0015;
  switch (pattern) {
    case 'engrave':
      for (const side of [-1, 1]) { draw(x + side*(w/2 + e), y + h*0.22, z, 0.002, h*0.1, d*0.86, accent); draw(x + side*(w/2 + e), y - h*0.22, z, 0.002, h*0.1, d*0.86, accent); }
      for (let i = -1; i <= 1; i++) for (const side of [-1, 1]) draw(x + side*(w/2 + e), y, z + i*d*0.25, 0.002, h*0.28, h*0.28, accent);
      break;
    case 'inlay':
      for (const side of [-1, 1]) draw(x + side*(w/2 + e), y, z, 0.002, Math.max(0.003, h*0.12), d*0.9, accent);
      draw(x, y + h/2 + e, z + d*0.3, w*0.3, 0.002, w*0.3, accent);
      break;
    case 'stripe':
      draw(x, y + h/2 + e, z, w*0.3, 0.002, d*0.98, accent);
      break;
    case 'bands':
      for (const t of [-0.32, 0, 0.32]) draw(x, y, z + t*d, w + 2*e, h + 2*e, Math.min(0.012, d*0.08), accent);
      break;
    case 'tiger':
      for (let i = 0; i < 5; i++) { const t = -0.4 + i*0.2; draw(x, y + h*0.15, z + t*d, w + 2*e, h*0.55, Math.min(0.016, d*0.09), accent); }
      break;
  }
}
