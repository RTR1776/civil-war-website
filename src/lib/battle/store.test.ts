import { resolveActiveTimelineEvent, useBattleStore } from "@/lib/battle/store";
import type { BattleDataBundle } from "@/lib/battle/types";

const SAMPLE_BUNDLE: BattleDataBundle = {
  manifest: {
    id: "test",
    name: "Test",
    date: "1864-11-30",
    timeStart: "1864-11-30T12:00:00-06:00",
    timeEnd: "1864-11-30T21:00:00-06:00",
    timezone: "America/Chicago",
    bounds: { north: 35.94, south: 35.9, east: -86.8, west: -86.89 },
    terrain: { verticalScale: 20, roughness: 0.6 },
  },
  units: [
    {
      id: "unit-1",
      name: "Unit 1",
      side: "Union",
      commander: "Cmdr",
      strengthEstimate: 1000,
    },
  ],
  timeSlices: [
    {
      timestamp: "1864-11-30T12:00:00-06:00",
      confidence: "documented",
      unitPositions: [{ unitId: "unit-1", lat: 35.91, lng: -86.87 }],
    },
    {
      timestamp: "1864-11-30T13:00:00-06:00",
      confidence: "documented",
      unitPositions: [{ unitId: "unit-1", lat: 35.92, lng: -86.86 }],
    },
  ],
  narrativeBeats: [
    {
      id: "beat-1",
      time: "1864-11-30T13:00:00-06:00",
      title: "Beat",
      description: "Desc",
      cameraPose: { lat: 35.92, lng: -86.86, distance: 40, pitch: 32, yaw: 18 },
      focusUnitIds: ["unit-1"],
    },
  ],
  mapLabels: [],
  timelineEvents: [
    {
      id: "event-1",
      time: "1864-11-30T13:00:00-06:00",
      title: "Event",
      detail: "Detail",
      confidence: "documented",
    },
  ],
  casualtyTimeline: [
    {
      time: "1864-11-30T12:00:00-06:00",
      cumulativeCasualties: 0,
      confidence: "documented",
    },
    {
      time: "1864-11-30T13:00:00-06:00",
      cumulativeCasualties: 120,
      confidence: "documented",
    },
  ],
  sources: [],
};

describe("battle store", () => {
  beforeEach(() => {
    useBattleStore.setState({
      data: null,
      selectedTime: 0,
      isPlaying: false,
      speed: 1,
      guidedMode: false,
      activeBeatId: null,
      hoveredEventId: null,
    });
  });

  it("sets guided mode and active beat when selecting a narrative beat", () => {
    const state = useBattleStore.getState();
    state.setData(SAMPLE_BUNDLE);
    state.selectBeat(SAMPLE_BUNDLE.narrativeBeats[0]);

    const next = useBattleStore.getState();
    expect(next.activeBeatId).toBe("beat-1");
    expect(next.guidedMode).toBe(true);
    expect(next.selectedTime).toBe(Date.parse("1864-11-30T13:00:00-06:00"));
  });
});

describe("resolveActiveTimelineEvent", () => {
  it("returns nearest event inside threshold", () => {
    const event = resolveActiveTimelineEvent(
      Date.parse("1864-11-30T13:08:00-06:00"),
      SAMPLE_BUNDLE.timelineEvents,
    );

    expect(event?.id).toBe("event-1");
  });

  it("returns null when no event is near", () => {
    const event = resolveActiveTimelineEvent(
      Date.parse("1864-11-30T18:00:00-06:00"),
      SAMPLE_BUNDLE.timelineEvents,
    );

    expect(event).toBeNull();
  });
});
