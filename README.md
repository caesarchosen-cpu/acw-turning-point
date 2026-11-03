# American Civil War Turning Point (Browser Prototype)

Three.js real-time strategy sketch of Gettysburg Day 1. **No build step** — static files + vendored `three.min.js`.

## Run

From this folder:

```bash
cd /workspace/browser_rts
python3 -m http.server 8765
```

Then open **http://localhost:8765/** (or `http://127.0.0.1:8765/`).

Alternatively: `npx --yes serve -l 8765` and open the printed URL.

> Opening `index.html` via `file://` may work for this build, but a local static server is recommended.

## Side select
- **Play as Union — default** (or press **Enter**)
- **Play as Confederacy (CSA)**

## Controls
| Input | Action |
|-------|--------|
| LMB | Select one friendly unit |
| LMB drag | Box-select friendlies (Shift adds) |
| RMB | Context order: enemy=attack, ground=move, capture point=move, own regiment=rejoin |
| W / S | Camera forward / back (heading-relative) |
| A / D | Camera pan left / right |
| Q / E | Camera strafe left / right |
| R / G | Rotate camera left / right |
| Z / X | Zoom in / out |
| Mouse wheel | Zoom |
| Screen edge | Pan (suppressed while box-dragging) |
| C | Fire selection (1 unit = Ordered-direct; many = Ordered-discretion commence) |
| Per-unit Fire buttons | Ordered-direct volley for that unit |
| H | Toggle Hold Fire / Fire at Will |
| F | Dismount / Mount (cavalry selected only) |
| K | Detach Skirmishers / Rejoin (line infantry / detached skirmishers) |
| B | Build wall mode (engineers selected) |
| M | Mute music |
| V | Voice briefings mute |
| Space | Skip Day 3 barrage |
| Esc | Cancel build mode |

## Troop types
| Type | Role |
|------|------|
| Line Infantry | Bulk of the army. Highest HP and DPS. Tight large ranks. Owns a ~10% skirmish company (detach with K). |
| Skirmishers | Detached company only (or dismounted cavalry). Loose spacing, 50% ranged damage taken. |
| Artillery | Longest range, high per-shot damage, slow reload (DPS below line). Weak inside min range. |
| Cavalry | Fastest mounted. Short range / charge. Fragile to volleys. F to dismount (uses skirmisher stats, faster reload). |

## Day 1 objective
- **Union:** Delay Heth on McPherson Ridge west of town until I Corps arrives, then fall back to Cemetery Hill.
- **CSA:** Drive Union troops off McPherson and Seminary Ridges and seize the town of Gettysburg.

## Testing hook
`window.__RTS__` exposes `start`, `units`, `selected`, `selectByType`, `moveSelectedTo`, `buildWallAt`, `setCamera`, `objectives`, etc.

## Layout
```
browser_rts/
  index.html
  README.md
  design_doc.md
  vendor/three.min.js
  js/world.js units.js camera.js input.js hud.js game.js main.js
```


## Music
Side-specific looping fife-and-drum (starts when you pick a side; **Mute** button or **M**):

| Side | Track | Source / license |
|------|-------|------------------|
| Union | `assets/music/union_yankee_doodle_fife_drum.wav` | Original synthesis of the public-domain melody **Yankee Doodle** (fife + snare/bass pattern). Melody is public domain; recording is original to this project (CC0). |
| CSA | `assets/music/csa_dixie_fife_drum.wav` | Original synthesis of the public-domain melody **Dixie** (fife + drum). Melody is public domain; recording is original to this project (CC0). |

Played via an HTML `<audio>` element (no `fetch`), so it works from `file://` as well as a local server.

## Capture points
Three sequential objectives per day. Hold a point (friendlies in radius, no enemies) to unlock the next. HUD: `Objective N/3: Take <landmark> — P%`.

**Day 1 Union:** McPherson Ridge → Seminary Ridge → Cemetery Hill  
**Day 1 CSA:** Herr Ridge / McPherson Ridge → Seminary Ridge → Town Square

## Voice briefings
Spoken + on-screen briefings on side select and when objectives unlock.

| Side | Voice approach |
|------|----------------|
| Union | Prefer `en-IE` / Irish-named `speechSynthesis` voices; Irish-American sergeant copy |
| CSA | Southern dialect copy; en-US male TTS at slower rate / lower pitch (browser limitation) |

Optional pre-recorded files (used automatically if present): `assets/voice/union_start.mp3`, `union_obj1.mp3`, … and `csa_*.mp3`. **V** toggles voice; **M** toggles music only.

True regional accents need voice-actor recordings or an external TTS service — drop MP3s into `assets/voice/`.

## Briefings preview
Open **[briefings.html](briefings.html)** (same folder) to hear every Union / CSA line without starting a match. Play per line, Play all Union/CSA, Play everything, Stop — shows which TTS voice was selected.


## Supply & ammo
- Line/skirmish ammo = men × 40 rounds; artillery has limited shells per gun.
- Yellow marker = low ammo (<25%); red = out (cannot volley except cavalry saber contact).
- **Wagons** (Day 1: 5/side, Day 2: 4, Day 3: 3): selectable, slow, right-click move. Refill idle friendly units (no fire ~5s). Empty wagons stay inert.
- Unguarded wagons can be captured; artillery can destroy them.
- **Depots** (~6/day): finite stock (forward less, rear more). Wagons refill from controlled depots. Stock trickles back at **one line-infantry full load / minute** (`men × 40` = **720 rounds/min**), capped at start stock; paused while contested.
- HQ rear zones heal out-of-combat units; destroyed units do not return that day.

## Cavalry arms
- Mounted: **Sharps carbine** beyond ~25% of max range; **revolver** then **saber** up close (saber uses no ammo).
- Dismounted (F): skirmisher stats + faster breechloader reload.

## Touch / Android
- **PWA:** `manifest.webmanifest` + `sw.js` (Add to Home Screen / standalone).
- **Touch:** tap select, drag box, long-press = order (RMB), two-finger pan/pinch, on-screen PAN pad + FIRE/HOLD/MOUNT/SKIRM/zoom when `(pointer: coarse)`.
- **Capacitor:** see `android-wrap/README_ANDROID.md`. Debug APK: `ACW_Turning_Point_debug.apk`.
- Music playlist recordings are **pending approval** and are **not** wired in yet (previews in `/workspace/music_preview/`).

## Range rings
- Unit **max + effective** range rings show **only for the current selection** (brass, 96 segments, thin stroke, `depthTest: false`).
- Capture zones: active point only (subtle parchment ring). Depots: soft fill, no stroke. HQ: tent cluster only (no zone ring).
