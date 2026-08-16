import { TerrainModel } from "@/features/battlefield/three/heightfield";
import {
  cavalryBlock,
  figureCount,
  infantryLine,
  offsetToWorld,
} from "@/features/battlefield/three/troopLayout";
import { vantagePoints } from "@/features/battlefield/three/viewpoints";
import { createProjection } from "@/features/battlefield/engine/projection";
import { buildFranklinBundle } from "@/test-utils/franklinFixture";

const bundle = buildFranklinBundle();

describe("TerrainModel", () => {
  const terrain = new TerrainModel(bundle);

  it("raises Winstead Hill well above the plain", () => {
    const winstead = terrain.projection.toWorld(35.9096, -86.862);
    const plain = terrain.projection.toWorld(35.918, -86.868);

    expect(terrain.elevation(winstead.x, winstead.y)).toBeGreaterThan(18);
    expect(Math.abs(terrain.elevation(plain.x, plain.y))).toBeLessThan(6);
  });

  it("cuts the Harpeth channel below water level", () => {
    // A point directly on the river polyline.
    const river = terrain.projection.toWorld(35.9324, -86.8542);
    expect(terrain.elevation(river.x, river.y)).toBeLessThan(TerrainModel.WATER_LEVEL);
  });

  it("keeps dry ground above water level away from the river", () => {
    const carter = terrain.projection.toWorld(35.9224, -86.8597);
    expect(terrain.elevation(carter.x, carter.y)).toBeGreaterThan(TerrainModel.WATER_LEVEL + 3);
  });

  it("measures river distance sensibly", () => {
    const river = terrain.projection.toWorld(35.9324, -86.8542);
    const carter = terrain.projection.toWorld(35.9224, -86.8597);

    expect(terrain.riverDistance(river.x, river.y)).toBeLessThan(40);
    expect(terrain.riverDistance(carter.x, carter.y)).toBeGreaterThan(400);
  });
});

describe("troop layout", () => {
  it("lays infantry out in two ranks centered on the position", () => {
    const offsets = infantryLine(40);
    expect(offsets).toHaveLength(40);

    const meanAlong = offsets.reduce((sum, offset) => sum + offset.along, 0) / offsets.length;
    expect(Math.abs(meanAlong)).toBeLessThan(3);

    const frontRank = offsets.filter((offset) => offset.advance > -2.5);
    const rearRank = offsets.filter((offset) => offset.advance <= -2.5);
    expect(frontRank.length).toBeGreaterThan(10);
    expect(rearRank.length).toBeGreaterThan(10);
  });

  it("gives cavalry a broader, deeper block", () => {
    const offsets = cavalryBlock(30);
    expect(offsets).toHaveLength(30);
    const minAdvance = Math.min(...offsets.map((offset) => offset.advance));
    expect(minAdvance).toBeLessThan(-10);
  });

  it("rotates offsets into world space by heading", () => {
    // Facing east (heading 0): "advance" is +x, "along" is +y.
    const east = offsetToWorld(100, 200, 0, { along: 10, advance: 5 });
    expect(east.x).toBeCloseTo(105);
    expect(east.y).toBeCloseTo(210);

    // Facing south (heading π/2): advance goes +y.
    const south = offsetToWorld(0, 0, Math.PI / 2, { along: 0, advance: 10 });
    expect(south.x).toBeCloseTo(0, 5);
    expect(south.y).toBeCloseTo(10, 5);
  });

  it("scales figure counts with strength and clamps", () => {
    expect(figureCount(4200, 18, 320)).toBe(233);
    expect(figureCount(100000, 18, 320)).toBe(320);
    expect(figureCount(10, 18, 320)).toBe(4);
  });
});

describe("vantage points", () => {
  it("provides the cinematic presets inside the battlefield frame", () => {
    const projection = createProjection(bundle.manifest.bounds);
    const vantages = vantagePoints(projection);

    expect(vantages.map((vantage) => vantage.id)).toEqual(
      expect.arrayContaining(["salient", "winstead", "granger", "flank", "charge"]),
    );

    for (const vantage of vantages) {
      expect(Math.abs(vantage.target.x)).toBeLessThan(projection.widthM);
      expect(Math.abs(vantage.target.z)).toBeLessThan(projection.heightM);
      expect(vantage.position.y).toBeGreaterThan(30);
    }

    expect(vantages.find((vantage) => vantage.id === "charge")?.followFormationId).toBe(
      "conf-cleburne-division",
    );
  });
});

describe("cavalry data", () => {
  const cavalryIds = ["conf-forrest-cavalry", "union-wilson-cavalry", "conf-chalmers-cavalry"];

  it("includes every cavalry command with a movement track", () => {
    for (const id of cavalryIds) {
      expect(bundle.formations.find((formation) => formation.id === id)?.arm).toBe("cavalry");
    }

    for (const keyframe of bundle.movementKeyframes) {
      const ids = keyframe.positions.map((position) => position.formationId);
      for (const id of cavalryIds) {
        expect(ids).toContain(id);
      }
    }
  });

  it("places Wilson's command in its own corps, not the Army of the Cumberland", () => {
    const wilson = bundle.formations.find((formation) => formation.id === "union-wilson-cavalry");

    // Wilson led the Cavalry Corps of the Military Division of the Mississippi;
    // Schofield's infantry corps belonged to different armies.
    expect(wilson?.army).toMatch(/Military Division of the Mississippi/);
    expect(wilson?.army).not.toMatch(/Army of the Cumberland/);
  });

  it("keeps the river crossing to Forrest's east wing and returns it by nightfall", () => {
    const forrest = bundle.formations.find((formation) => formation.id === "conf-forrest-cavalry");
    // Only Buford's and Jackson's divisions crossed; Chalmers screened the west flank.
    expect(forrest?.strengthEstimate).toBeLessThan(3000);

    const engagedAt = (iso: string) =>
      bundle.movementKeyframes
        .find((keyframe) => keyframe.timestamp === iso)
        ?.positions.find((position) => position.formationId === "conf-forrest-cavalry")?.engaged;

    // The cavalry fight peaks in the afternoon and is over before full dark.
    expect(engagedAt("1864-11-30T16:00:00-06:00")).toBe(true);
    expect(engagedAt("1864-11-30T19:00:00-06:00")).toBe(false);
  });
});
