import { buildFranklinBundle, franklinFiles } from "@/test-utils/franklinFixture";
import { buildScenarioBundle } from "@/lib/battle/scenarioLoader";
import { validateScenarioData } from "@/lib/battle/validation";

describe("validateScenarioData", () => {
  it("accepts the Franklin dataset", () => {
    const result = validateScenarioData(buildFranklinBundle());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when an unknown formation id is referenced", () => {
    const divisions = franklinFiles.divisions;
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
        ...franklinFiles,
        divisions: tamperedDivisions,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("unknown formation id");
  });

  it("fails when an account cites a source that does not exist", () => {
    const voices = franklinFiles.voices?.voices ?? [];
    const result = validateScenarioData(
      buildScenarioBundle({
        ...franklinFiles,
        voices: {
          ...franklinFiles.voices,
          voices: [{ ...voices[0], sourceId: "source-does-not-exist" }, ...voices.slice(1)],
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("Unknown evidence source reference in account")),
    ).toBe(true);
  });

  it("fails when an account sits outside the battle window", () => {
    const voices = franklinFiles.voices?.voices ?? [];
    const result = validateScenarioData(
      buildScenarioBundle({
        ...franklinFiles,
        voices: {
          ...franklinFiles.voices,
          voices: [{ ...voices[0], time: "1864-12-01T09:00:00-06:00" }, ...voices.slice(1)],
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("Account timestamp outside scenario window")),
    ).toBe(true);
  });

  it("fails when a chapter has no evidence refs", () => {
    const chapters = franklinFiles.chapters ?? [];
    const tamperedChapters = [
      {
        ...chapters[0],
        evidenceRefs: [],
      },
      ...chapters.slice(1),
    ];

    const result = validateScenarioData(
      buildScenarioBundle({
        ...franklinFiles,
        chapters: tamperedChapters,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Chapter requires evidence linkage"))).toBe(true);
  });
});
