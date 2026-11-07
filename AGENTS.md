# BULLET TIME engineering rules

- Preserve the feel: bullet time slows the world, never the player's aim; every bullet is a real projectile; shootdodge is free and always bends time; the final bullet of a wave gets the camera.
- Runtime is vanilla HTML/CSS/JS, raw WebGL (2 with 1 fallback), Canvas 2D, Pointer Lock and synthesized Web Audio. No frameworks, engines, CDNs, remote fonts, imported art or runtime npm dependencies.
- Keep it original and single-player. No proprietary names, characters, maps, audio or logos.
- Simulation lives in src/game.js and receives REAL time in fixed 120 Hz ticks; it derives the world, player and weapon clocks itself. Gameplay randomness is seeded; visual effects use a separate RNG.
- Collision, bullet sweeps and enemy sight use the same world boxes. Nobody shoots through cover; glass never stops a round.
- Pause, focus loss, pointer unlock (mouse) and controller disconnect (Xbox) stop the simulation and clear held input. Restart creates a fresh Game without adding listeners or loops.
- Skins are data in src/skins.js. After changing them run `npm run skins` (regenerates assets/skins/ and the sw.js skin list) and bump sw.js REVISION when cached files change.
- Run npm test, npm run check and npm run build. scripts/browser-check.cjs is CI tooling (Playwright) and renders the packaged game.
