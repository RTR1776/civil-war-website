import manifest from "../../../public/data/franklin/manifest.json";
import divisions from "../../../public/data/franklin/divisions.json";
import events from "../../../public/data/franklin/events.json";
import sources from "../../../public/data/franklin/sources.json";

import { validateBattleData } from "@/lib/battle/validation";

describe("validateBattleData", () => {
  it("accepts the Franklin dataset", () => {
    const result = validateBattleData({
      manifest,
      units: divisions.units,
      timeSlices: divisions.timeSlices,
      narrativeBeats: events.narrativeBeats,
      mapLabels: events.mapLabels,
      timelineEvents: events.timelineEvents,
      casualtyTimeline: events.casualtyTimeline,
      sources,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when an unknown unit id is referenced", () => {
    const tampered = {
      ...divisions,
      timeSlices: [
        {
          ...divisions.timeSlices[0],
          unitPositions: [
            ...divisions.timeSlices[0].unitPositions,
            { unitId: "missing-id", lat: 35.91, lng: -86.86 },
          ],
        },
      ],
    };

    const result = validateBattleData({
      manifest,
      units: divisions.units,
      timeSlices: tampered.timeSlices,
      narrativeBeats: events.narrativeBeats,
      mapLabels: events.mapLabels,
      timelineEvents: events.timelineEvents,
      casualtyTimeline: events.casualtyTimeline,
      sources,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unknown unit id");
  });
});
