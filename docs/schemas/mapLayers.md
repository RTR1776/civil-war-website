# `mapLayers.json` schema

Top-level: map layer pack object.

## Map layer pack fields
- `id` (`string`, required)
- `name` (`string`, required)
- `description` (`string`, optional)
- `features` (`Feature[]`, required)

## Feature
- `type` (`"Feature"`, required)
- `geometry` (`GeoJSON Geometry`, required)
- `properties` (`MapLayerFeatureProperties`, required)

## MapLayerFeatureProperties
- `id` (`string`, required)
- `name` (`string`, required)
- `category` (`"road" | "river" | "terrain" | "works" | "landmark" | "sector"`, required)
- `styleKey` (`string`, required): renderer style token.
- `confidence` (`"documented" | "inferred"`, required)
- `evidenceRefs` (`EvidenceRef[]`, required)

## EvidenceRef
- `sourceId` (`string`, required)
- `claimId` (`string`, optional)
- `note` (`string`, optional)
- `quote` (`string`, optional)
