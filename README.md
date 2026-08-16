# The Battle of Franklin — November 30, 1864

A cinematic, interactive reconstruction of the Battle of Franklin. Five hours of
fighting play out hour by hour on a hand-drawn 1864-style map — from the view
off Winstead Hill, through the grand assault and the breach at the Carter
House, into the famous fight in total darkness — ending with a memorial to the
six Confederate generals lost.

Everything renders in a custom HTML5 canvas engine. **No map tokens, tiles, or
external services are required** — clone, install, run.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional: set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to enable the extra
**Satellite** view (a modern-day Mapbox comparison). Without it the site is
fully functional on the built-in engine.

## The experience

- **Cinematic intro** — title sequence with animated statistics over a slowly
  drifting attract camera.
- **Story mode** — guided playback through five chapters on authored camera
  rails; narrative beats surface as lower-third captions as the clock crosses
  them; each chapter plays for a consistent screen time regardless of its
  historical span.
- **The living map** — parchment terrain with hachured hills, the Harpeth
  River, pikes, the Nashville & Decatur railroad, the Federal earthworks
  (sawtooth entrenchment symbology), and the town grid of Franklin. Division
  blocks move along their documented tracks, shrink with attrition, trade
  musket-flash and powder-smoke particle fire when engaged — and the whole
  field passes through golden hour, dusk, and a moonless night in which the
  fighting is lit by muzzle flashes.
- **Explore mode** — free pan/zoom/pinch, hover tooltips, click a division for
  a live intel card (strength, losses so far, order, engagement, confidence),
  and optionally lock the camera to follow it.
- **Control dock** — scrubbable timeline with chapter segments and event pips,
  play/pause and 1×/2×/4× speeds, a battlefield clock with day-phase badge
  (rendered in the battle's own UTC−6 time, not the visitor's timezone), and a
  climbing casualty counter.
- **Records** — every claim on the map is tagged *documented* or *inferred*;
  the records panel lists claims, sources, and data-integrity checks, with
  "trace on timeline" jumps.
- **Epilogue** — documented casualty totals, the six fallen generals, and the
  aftermath.

Keyboard: `Space` play/pause · `←`/`→` step 15 minutes · `Esc` close panels.
Honors `prefers-reduced-motion` (no particles, instant camera).

## Architecture

```
src/
  app/                      Next.js shell + global design system
  features/battlefield/
    BattlefieldExperience   Top-level stage: overlays, HUD, keyboard control
    CanvasBattlefield       Canvas host: RAF loop, camera direction, input
    engine/
      scene.ts              The painter: terrain, layers, troops, lighting
      camera.ts             Eased camera with world<->screen transforms
      direction.ts          Chapter rails, beat poses, attract shots
      particles.ts          Musket flash + smoke systems
      projection.ts         Local meters projection + Mapbox-zoom mapping
    ControlDock / StoryRail / IntelCard / RecordsPanel /
    IntroOverlay / EpilogueOverlay
    PresentDayMapbox        Optional satellite comparison (token-gated)
  lib/battle/
    store.ts                Zustand simulation/story state (chapter-paced playback)
    interpolation.ts        Position + casualty interpolation
    time.ts                 Battle clock (fixed UTC−6), day phases, light curve
    scenarioLoader.ts       Data loading + legacy adaptation
    validation.ts           Evidence-linkage validation
```

The render loop reads the store transiently (no React re-render per frame);
UI components subscribe to coarse time slices only.

## Data

Franklin content lives in `public/data/franklin`:
`manifest.json`, `divisions.json`, `events.json`, `chapters.json`,
`mapLayers.json`, `evidence.json`, `sources.json`.

Schema docs are in `docs/schemas/`. Chapter camera rails use sim-time
`timeOffsetMs` from the chapter start. Map-layer features accept an optional
`radiusM` on `hill` points for the hachure renderer. Geometry is approximate
and stylized; every feature carries evidence references.

```bash
npm run scenario:validate   # referential-integrity checks
npm run scenario:pack       # regenerate render-pack.json
```

## Testing

```bash
npm test          # vitest unit suite (engine math, store, time, shell)
npm run test:e2e  # Playwright: intro, story, scrub, records, epilogue, mobile
```

In environments with a preinstalled Chromium, point Playwright at it:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e`.

## Historical note

Times display in the battle's local mean time (fixed UTC−6). Sunset on
November 30, 1864 at Franklin came at roughly 4:33 PM, with a nearly new
moon — most of the battle really was fought in darkness. On-map positions and
the live casualty curve interpolate between documented fixes and are tagged
accordingly; documented totals appear in the epilogue with citations.
