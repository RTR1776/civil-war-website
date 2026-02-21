import manifest from "../../../public/data/franklin/manifest.json";
import divisions from "../../../public/data/franklin/divisions.json";
import events from "../../../public/data/franklin/events.json";
import sources from "../../../public/data/franklin/sources.json";
import chapters from "../../../public/data/franklin/chapters.json";
import mapLayers from "../../../public/data/franklin/mapLayers.json";
import evidence from "../../../public/data/franklin/evidence.json";

import { buildScenarioBundle } from "@/lib/battle/scenarioLoader";
import { validateScenarioData } from "@/lib/battle/validation";

describe("validateScenarioData", () => {
  it("accepts the Franklin dataset", () => {
    const result = validateScenarioData(
      buildScenarioBundle({
        manifest,
        divisions,
        events,
        sources,
        chapters,
        mapLayers,
        evidence,
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when an unknown formation id is referenced", () => {
    const tamperedDivisions = {
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

    const result = validateScenarioData(
      buildScenarioBundle({
        manifest,
        divisions: tamperedDivisions,
        events,
        sources,
        chapters,
        mapLayers,
        evidence,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unknown formation id");
  });

  it("fails when a chapter has no evidence refs", () => {
    const tamperedChapters = [
      {
        ...chapters[0],
        evidenceRefs: [],
      },
      ...chapters.slice(1),
    ];

    const result = validateScenarioData(
      buildScenarioBundle({
        manifest,
        divisions,
        events,
        sources,
        chapters: tamperedChapters,
        mapLayers,
        evidence,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Chapter requires evidence linkage"))).toBe(true);
  });
});
