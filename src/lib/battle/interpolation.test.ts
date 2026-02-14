import { clampTime, getConfidenceStyle, interpolateUnitPositions } from "@/lib/battle/interpolation";
import type { TimeSlice } from "@/lib/battle/types";

const SAMPLE_SLICES: TimeSlice[] = [
  {
    timestamp: "1864-11-30T12:00:00-06:00",
    confidence: "documented",
    unitPositions: [
      { unitId: "a", lat: 35.9, lng: -86.8, engaged: false },
      { unitId: "b", lat: 35.91, lng: -86.82, engaged: false },
    ],
  },
  {
    timestamp: "1864-11-30T13:00:00-06:00",
    confidence: "inferred",
    unitPositions: [
      { unitId: "a", lat: 35.92, lng: -86.78, engaged: true },
      { unitId: "b", lat: 35.915, lng: -86.81, engaged: false },
    ],
  },
];

describe("interpolateUnitPositions", () => {
  it("interpolates lat/lng between slices", () => {
    const midpoint = Date.parse("1864-11-30T12:30:00-06:00");
    const result = interpolateUnitPositions(midpoint, SAMPLE_SLICES);

    const unitA = result.find((position) => position.unitId === "a");

    expect(unitA).toBeDefined();
    expect(unitA?.lat).toBeCloseTo(35.91, 5);
    expect(unitA?.lng).toBeCloseTo(-86.79, 5);
  });

  it("clamps at timeline boundaries", () => {
    const before = Date.parse("1864-11-30T11:00:00-06:00");
    const result = interpolateUnitPositions(before, SAMPLE_SLICES);

    const unitA = result.find((position) => position.unitId === "a");
    expect(unitA?.lat).toBeCloseTo(35.9, 5);
  });

  it("marks interpolated segment inferred when any side is inferred", () => {
    const midpoint = Date.parse("1864-11-30T12:30:00-06:00");
    const result = interpolateUnitPositions(midpoint, SAMPLE_SLICES);

    for (const unit of result) {
      expect(unit.confidence).toBe("inferred");
    }
  });
});

describe("clampTime", () => {
  it("returns lower bound when time is below range", () => {
    expect(clampTime(1, 5, 9)).toBe(5);
  });

  it("returns upper bound when time is above range", () => {
    expect(clampTime(11, 5, 9)).toBe(9);
  });
});

describe("getConfidenceStyle", () => {
  it("returns style for documented confidence", () => {
    expect(getConfidenceStyle("documented")).toEqual({ opacity: 1, dashed: false });
  });

  it("returns style for inferred confidence", () => {
    expect(getConfidenceStyle("inferred")).toEqual({ opacity: 0.5, dashed: true });
  });
});
