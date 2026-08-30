# `voices.json` schema

First-person accounts of the battle. Every entry is a **verbatim quotation**
from a published source; nothing here is paraphrase, summary, or invention. An
entry whose wording cannot be quoted exactly does not belong in this file.

Top-level object fields:
- `voices` (`VoiceAccount[]`, required) — accounts on the battle clock
- `epilogueVoices` (`VoiceAccount[]`, optional) — accounts of the morning
  after, shown with the epilogue rather than on the timeline

## VoiceAccount
- `id` (`string`, required)
- `time` (ISO 8601 with the battle's `-06:00` offset, required for `voices`,
  omitted for `epilogueVoices`) — when the words were spoken or when the
  moment they describe happened
- `speaker` (`string`, required) — as it should read on the card, e.g.
  `"Maj. Gen. Patrick R. Cleburne"`. The map label uses the last word.
- `role` (`string`, required) — command, regiment, or position on the field
- `side` (`"Union" | "Confederate"`, required) — colors the card and the mark
- `quote` (`string`, required) — the words themselves, exactly. Use `…` for
  an elision and curly quotes for quoted speech inside the quotation.
- `context` (`string`, required) — what the reader needs to know to place it
- `place` (`string`, optional) — human-readable location
- `lat` / `lng` (`number`, optional) — where the mark is drawn on the map;
  both must be present for a mark to appear
- `confidence` (`"documented" | "inferred"`, required)
- `sourceId` (`string`, required) — must resolve in `sources.json`

## Validation

`npm run scenario:validate` and `validateScenarioData` both reject an account
with an empty quote, a `sourceId` that does not resolve, a missing or
malformed `time`, or a time outside the scenario window.
