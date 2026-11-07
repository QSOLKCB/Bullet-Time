# v1.0.0 — Time Dilation

**Slow the world. Never your aim.**

The first release of BULLET TIME: an original single-player first-person shooter about bending time. Every bullet in the room is a real projectile you can watch cross the hall, dive away from, and answer before it lands. It's built on the QUICKSCOPER foundation with vanilla HTML/CSS/JavaScript, raw WebGL, Canvas 2D and Web Audio. No engine, frameworks or runtime dependencies.

## Bullet time

- Press **Q** or **right click** (or **LT**) to drop the world to **22% speed**. Your mouse look stays real-time, you move at **half speed** and your guns cycle at **80%**, so you get the edge.
- The view goes warm and desaturated, sound sinks under a low-pass filter, the music slows and a heartbeat comes in.
- The hourglass meter drains while it's active. Kills refill it (headshots refill more), and it recovers to **30%** on its own. Prefer holding the button? There's a setting for that.

## Shootdodge

- Press **Shift** (or **B**) while moving to launch into a dive in that direction. With no direction, you dive backwards.
- Diving bends time automatically and costs no meter. You're a small, fast target, the camera rolls with the dive, and you land on your back for a moment, still able to shoot.

## Real bullets

- Your rounds travel at **150 m/s** and enemy rounds at **30 m/s**, swept against the world every tick. Nothing is instant hitscan.
- In bullet time you can see every streak, the air ripples it leaves and the casings tumbling out of your pistols. Enemy rounds you step away from whistle past.
- Enemies glow red at the muzzle before they fire, and a damage arc points at whoever just hit you.

## The final bullet

- When your shot will kill the last enemy of a wave, the camera rides the bullet in at a few percent of normal speed, then orbits the falling body.
- It can be turned off in Settings.

## Bodies and glass

- Enemies are thrown along the bullet's path, topple backwards and tumble. The shotgun throws hardest.
- Glass partitions shatter into slow-tumbling shards when shot, dived through or barged by enemies. Glass never stops a round.

## Arsenal and opposition

| Weapon | Notes |
| --- | --- |
| **Twin .45** | Akimbo pistols that alternate hands, 24 rounds |
| **Breacher 12** | Pump shotgun, 9 pellets, heavy knockback |
| **Vector Carbine** | Fully automatic, 32 rounds; bloom grows with sustained fire |

Three voxel-android enemy types:
- **Grunts** fire 3-round bursts.
- **Runners** are fast flankers that spray 5.
- **Heavies** are armoured and fire 6-pellet blasts.

They route around cover with a shared flow field and smash through any glass in their way. Waves grow and mix in tougher types as you go.

## Skins

Open **◈ Skins** from the menu or pause screen. Skins are cosmetic only.
- **Six finishes for each gun:** Factory, Ivory & Brass (engraved), Ember (glowing inlay), Chrome Noir, Jade and Tiger Stripe.
- **Four enemy looks:** Syndicate, Chrome Agents, Night Shift and Masquerade.

Swatches are generated from the same data the renderer uses, so previews always match the game.

## Modes and scoring

- **The Gauntlet:** endless waves, one life.
- **The Range:** practice with no incoming fire.
- **Scoring:**

| Event | Points |
| --- | --- |
| Kill | 100 (runner 120, heavy 200) |
| Headshot | +50 |
| Fired in bullet time | +50 |
| Mid-dive | +100 |
| Long shot (over 24 m) | +50 |
| Chain kills within 3.2 s | Up to 5× |
| Wave clear | +250 × wave number, plus 30 health and 25 hourglass |

- Results track waves, accuracy, headshots, bullet-time and mid-dive kills, best chain and glass broken. Your personal best stays on your device.

## Controls and comfort

- Keyboard and mouse, or an Xbox controller using the standard Gamepad mapping.
- Settings:
  - Mouse sensitivity and controller look speed.
  - Stick deadzone and inverted look.
  - Master and music volume.
  - Toggle or hold bullet time, and the final-kill camera.
  - Reduced motion and flashes, lower resolution and fewer particles.
- Works offline after one visit (scope-isolated service worker).

## Verification

19 automated simulation tests pass. They cover:
- Real projectile travel, and the bullet-time clocks.
- Dodging, shootdodge, style scoring and ragdolls.
- Glass, weapons, the final-kill camera and waves.
- Enemy line of sight, slow-motion death, skins and the arena layout.

A packaged Chromium browser check also passes. It drives bullet time, a shootdodge, glass, the final-bullet camera, incoming fire, pause, death and the skins picker. Balance, mouse feel and real GPU performance have not yet been playtested by a person.

## Credits

Built on [QUICKSCOPER](https://github.com/QSOLKCB/QUICKSCOPER), with the fixed-step clock and projectile model from [VANILLAJS](https://github.com/QSOLKCB/VANILLAJS), the slow-motion meter idea from [AFTER-ZERO](https://github.com/QSOLKCB/AFTER-ZERO), and optimisation patterns from [OPT](https://github.com/QSOLKCB/OPT). See [NOTICE](NOTICE). Apache-2.0.
