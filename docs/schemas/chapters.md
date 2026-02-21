# `chapters.json` schema

Top-level: JSON array of chapter objects.

## Chapter fields
- `id` (`string`, required): unique chapter identifier.
- `title` (`string`, required): short chapter title used in UI and controls.
- `summary` (`string`, required): chapter synopsis for story panel and overlays.
- `startTime` (`ISO-8601 string`, required): chapter start in scenario timezone.
- `endTime` (`ISO-8601 string`, required): chapter end in scenario timezone.
- `beatIds` (`string[]`, required): ordered narrative beat ids included in chapter.
- `pivotalEventId` (`string`, optional): event id used by "skip to pivotal" control.
- `cameraRail` (`CameraRailKeyframe[]`, required): cinematic camera keyframes.
- `evidenceRefs` (`EvidenceRef[]`, required): source linkage for chapter claims.

## CameraRailKeyframe
- `timeOffsetMs` (`number`, required): milliseconds from chapter start.
- `lat` (`number`, required)
- `lng` (`number`, required)
- `zoom` (`number`, required)
- `pitch` (`number`, required)
- `bearing` (`number`, required)
- `overlayText` (`string`, optional)
- `eventId` (`string`, optional)
- `focusFormationIds` (`string[]`, optional)

## EvidenceRef
- `sourceId` (`string`, required)
- `claimId` (`string`, optional)
- `note` (`string`, optional)
- `quote` (`string`, optional)
