// Original generative score (no samples): a tense 96 BPM minor pulse built from
// Euclidean rhythms and equal-tempered pitch, 440 * 2^((note - 69) / 12).
// Intensity (the kill chain) adds layers; bullet time stretches and lowers it.
export const BPM = 96;
export const MUSIC_STEP = 60/BPM/4;
export const noteHz = note => 440*2**((note-69)/12);
export const pulse = (step, hits, steps = 16) => ((step%steps + steps)%steps*hits)%steps < hits;
export function musicStep(step, intensity = 0) {
  const bar = Math.floor(step/16), beat = step%16, root = [40,40,43,38][Math.floor(bar/2)%4];
  const notes = [];
  if (beat%4 === 0 || (beat === 10 && bar%2)) notes.push({note:root-12, duration:0.2, type:'sine', volume:0.3, end:28});
  if (pulse(step, 7)) notes.push({note:root, duration:0.12, type:'sawtooth', volume:0.05});
  if (intensity >= 1 && pulse(step+3, 5)) {
    const degree = [0,3,7,10,12,7][(step*5 + bar)%6];
    notes.push({note:root+24+degree, duration:0.16, type:'triangle', volume:0.06});
  }
  if (beat%4 === 2 || (intensity >= 2 && beat%2 === 1)) notes.push({note:100 + (beat%3), duration:0.02, type:'square', volume:0.012});
  if (intensity >= 3 && beat%8 === 4) notes.push({note:root+12, duration:0.3, type:'sawtooth', volume:0.04, end:noteHz(root)});
  return notes;
}
