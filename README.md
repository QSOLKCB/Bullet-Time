# BULLET TIME

**Slow the world. Never your aim.** An original single-player first-person shooter about bending time: every bullet in the room is a real projectile you can watch cross the hall, dive away from, and answer before it lands. Built directly on the web platform: raw WebGL, Canvas 2D and synthesized Web Audio. No engine, no frameworks, no runtime dependencies.

It is built on [QUICKSCOPER](https://github.com/QSOLKCB/QUICKSCOPER), with pieces from [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS), [AFTER-ZERO](https://github.com/QSOLKCB/AFTER-ZERO) and [OPT](https://github.com/QSOLKCB/OPT) (see [NOTICE](NOTICE)).

## Play

Any static server works (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Choose **The Gauntlet** (endless waves, one life, score attack) or **The Range** (practice, no incoming fire), then **Step into the terminal**.

| Action | Keyboard + mouse | Xbox |
| --- | --- | --- |
| Move / look | WASD / mouse | Left / right stick |
| Fire | Left click (hold for the carbine) | RT |
| **Bullet time** | **Q or right click** (toggle, or hold in Settings) | LT |
| **Shootdodge** | **Shift** (or F / middle click) while moving | B |
| Jump / crouch | Space / C or Ctrl | A / RS click |
| Reload | R | X |
| Weapons | 1 2 3 or mouse wheel | Y, LB, RB |
| Pause / mute | Esc or P / M | Menu |

## What bends

- **Bullet time.** The world drops to 22% speed. Mouse look stays real-time, your movement runs at half speed and your guns cycle at 80%, so you get a decisive edge. The view goes warm and desaturated, sound sinks under a low-pass filter, the music slows and a heartbeat comes in. The hourglass meter drains while it's active; kills refill it, headshots refill it more, and it recovers to 30% on its own.
- **Shootdodge.** Launch into a sideways, forward or backward dive (backward if you give no direction). Diving bends time automatically and costs no meter. You're a small, fast target, the camera rolls with the dive, and you land on your back for a moment, still able to shoot.
- **Real bullets.** Your rounds travel at 150 m/s and enemy rounds at 30 m/s, both swept against the world every tick. In bullet time you can see every streak, the air ripples it leaves and the casings tumbling out of your pistols. Rounds you step away from whistle past.
- **The final bullet.** When your shot will kill the last enemy of a wave, the camera rides the bullet in at a few percent of normal speed, then orbits the falling body. You can turn this off in Settings.
- **Ragdoll-style deaths.** Bodies are thrown along the bullet's path, topple backwards and tumble. Shotguns throw them hardest.
- **Glass.** Partitions shatter into slow-tumbling shards when shot, dived through or barged by enemies. Glass never stops a round.

## Arsenal and opposition

| Weapon | Notes |
| --- | --- |
| **Twin .45** | Akimbo pistols that alternate hands, 24 rounds. A head or torso pair drops a standard enemy. |
| **Breacher 12** | Pump shotgun, 9 pellets, huge knockback. |
| **Vector carbine** | Fully automatic, 32 rounds. Bloom grows with sustained fire. |

Enemies are voxel androids: **grunts** (3-round bursts), **runners** (fast flankers who spray 5) and **heavies** (armoured, 6-pellet blasts). Each one shows a red glow at the muzzle and visor before it fires. Grunts and runners lead a walking target, aiming part of the way toward where you'll be. They read your normal pace, so moving in bullet time outruns their aim, nobody can predict a shootdodge, and heavies just fire where you are. They route around cover with a shared flow field and smash through any glass in their way.

## Skins

Open **◈ Skins** on the menu (or **Skins** in the pause menu) to dress each gun and the enemy squads. All skins are cosmetic only.

| Weapon finishes (any gun) | Enemy looks |
| --- | --- |
| Factory, Ivory & Brass (engraved), Ember (glowing inlay), Chrome Noir (racing stripe), Jade (gilt bands), Tiger Stripe | Syndicate (suits), Chrome Agents (polished, glowing eyes), Night Shift (riot armour, red optics), Masquerade (pinstripes and porcelain masks) |

Skins are data in [`src/skins.js`](src/skins.js): a palette plus a surface pattern that the renderer turns into extra geometry. The menu swatches in [`assets/skins/`](assets/skins/) are generated from the same data with `npm run skins`, so previews always match the game. To add a skin, add an entry there and rerun `npm run skins`. That also updates the offline cache list.

## Scoring

Kill 100 (runner 120, heavy 200) · headshot +50 · fired in bullet time +50 · mid-dive +100 · long shot (over 24 m) +50 · chain kills within 3.2 s for up to 5× · wave clear +250 × wave, which also restores 30 health and 25 hourglass. Results track waves, accuracy, headshots, bullet-time and mid-dive kills, best chain and glass broken.

## Develop

Node 22+ is needed only for checks. There's no `npm install`.

```sh
npm test         # simulation tests (node --test)
npm run check    # syntax, local imports, asset and offline-cache checks
npm run skins    # regenerate skin swatches from src/skins.js
npm run build    # package dist/
```

`scripts/browser-check.cjs` (Playwright, CI tooling only) renders the game in Chromium with software WebGL, drives bullet time, a shootdodge, glass, the final-bullet camera, incoming fire, pause, death and the skin picker, and saves screenshots to `artifacts/`. The included workflow runs everything and deploys `dist/` to GitHub Pages on pushes to `main`. Enable it once under **Settings → Pages → Source → GitHub Actions**.

| File | Responsibility |
| --- | --- |
| `src/game.js` | Pure fixed-step simulation: three clocks (world / player / weapon), projectiles, dives, enemies, waves, killcam |
| `src/renderer.js` | WebGL: lit, additive-glow and point passes, figures and corpses, bullets, ripples, afterimages, glass, viewmodels, cameras |
| `src/skins.js` | Weapon and enemy skin data and pattern decals |
| `src/world.js` | Terminal Nine, an original transit concourse |
| `src/clock.js` | Fixed real-time tick accumulator with drift-repaying vsync snapping (from VANILLAJS 1.2) |
| `src/lead.js` | Constant-velocity intercept solver behind enemy aim (from VANILLAJS 1.2) |
| `src/frame-gate.js` | Skips redrawing the frozen frame on the pause and results screens (from VANILLAJS 1.2) |
| `src/audio.js`, `src/music.js` | Synthesized effects, slow-motion filter, generative score |
| `src/app.js` | Input, lifecycle, effects, overlay, HUD, settings and skins UI |

## Original work

The arena, characters, weapons, skins, UI and audio are original to this project. It's inspired by the slow-motion shooter genre but isn't affiliated with any existing game and uses none of their assets, names or characters. [Apache-2.0](LICENSE).
