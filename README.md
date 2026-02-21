# Franklin Immersive Story Engine

Interactive Civil War battlefield experience for the Battle of Franklin, focused on cinematic story playback, analyst tools, and evidence traceability.

## Run

```bash
npm install
NEXT_PUBLIC_EXPERIENCE_V2=1 npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` to enable full map rendering.

## Feature Flag

- `NEXT_PUBLIC_EXPERIENCE_V2=1`: enables the rebuilt immersive experience.
- If unset, the app currently falls back to the same V2 implementation path while rollout controls are retained.

## Data Model

Franklin content lives in `public/data/franklin`:
- `manifest.json`
- `divisions.json`
- `events.json`
- `chapters.json`
- `mapLayers.json`
- `evidence.json`
- `sources.json`

Schema docs:
- `docs/schemas/chapters.md`
- `docs/schemas/mapLayers.md`
- `docs/schemas/evidence.md`

## Validation and Build Pack

```bash
npm run scenario:validate
npm run scenario:pack
```

`scenario:pack` generates `public/data/franklin/render-pack.json` for render-optimized consumption.

## Testing

```bash
npm test
npm run test:e2e
```
