# `evidence.json` schema

Top-level object fields:
- `claims` (`EvidenceClaim[]`, required)

## EvidenceClaim
- `id` (`string`, required)
- `title` (`string`, required)
- `detail` (`string`, required)
- `confidence` (`"documented" | "inferred"`, required)
- `linkedEventIds` (`string[]`, optional)
- `linkedBeatIds` (`string[]`, optional)
- `linkedChapterIds` (`string[]`, optional)
- `evidenceRefs` (`EvidenceRef[]`, required)

## EvidenceRef
- `sourceId` (`string`, required)
- `claimId` (`string`, optional)
- `note` (`string`, optional)
- `quote` (`string`, optional)
