import { resolveActiveTimelineEvent, useBattleStore } from "@/lib/battle/store";
import type { ScenarioDataBundle } from "@/lib/battle/types";

const SAMPLE_BUNDLE: ScenarioDataBundle = {
  manifest: {
    id: "test",
    schemaVersion: 2,
    name: "Test",
    date: "1864-11-30",
    timeStart: "1864-11-30T12:00:00-06:00",
    timeEnd: "1864-11-30T21:00:00-06:00",
    timezone: "America/Chicago",
    bounds: { north: 35.94, south: 35.9, east: -86.8, west: -86.89 },
    terrain: { verticalScale: 20, roughness: 0.6 },
    defaultMode: "story",
    mapModes: ["reconstructed", "modern"],
    chapterOrder: ["chapter-1"],
  },
  formations: [
    {
      id: "unit-1",
      name: "Unit 1",
      side: "Union",
      commander: "Cmdr",
      strengthEstimate: 1000,
    },
  ],
  movementKeyframes: [
    {
      timestamp: "1864-11-30T12:00:00-06:00",
      confidence: "documented",
      interpolationHint: "linear",
      positions: [{ formationId: "unit-1", lat: 35.91, lng: -86.87 }],
    },
    {
      timestamp: "1864-11-30T13:00:00-06:00",
      confidence: "documented",
      interpolationHint: "linear",
      positions: [{ formationId: "unit-1", lat: 35.92, lng: -86.86 }],
    },
  ],
  narrativeBeats: [
    {
      id: "beat-1",
      time: "1864-11-30T13:00:00-06:00",
      title: "Beat",
      description: "Desc",
      cameraPose: { lat: 35.92, lng: -86.86, distance: 40, pitch: 32, yaw: 18 },
      focusFormationIds: ["unit-1"],
      confidence: "documented",
      evidenceRefs: [{ sourceId: "source-1" }],
    },
  ],
  chapters: [
    {
      id: "chapter-1",
      title: "Chapter",
      summary: "Summary",
      startTime: "1864-11-30T12:00:00-06:00",
      endTime: "1864-11-30T13:00:00-06:00",
      beatIds: ["beat-1"],
      pivotalEventId: "event-1",
      cameraRail: [
        {
          timeOffsetMs: 0,
          lat: 35.92,
          lng: -86.86,
          zoom: 14,
          pitch: 44,
          bearing: 14,
        },
      ],
      evidenceRefs: [{ sourceId: "source-1" }],
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
      evidenceRefs: [{ sourceId: "source-1" }],
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
  mapLayerPack: {
    id: "pack",
    name: "Pack",
    features: [],
  },
  evidenceSources: [
    {
      id: "source-1",
      title: "Source",
      author: "Author",
      year: 1864,
      note: "Note",
    },
  ],
  evidenceClaims: [
    {
      id: "claim-1",
      title: "Claim",
      detail: "Detail",
      confidence: "documented",
      linkedEventIds: ["event-1"],
      linkedChapterIds: ["chapter-1"],
      evidenceRefs: [{ sourceId: "source-1" }],
    },
  ],
};

describe("battle store", () => {
  beforeEach(() => {
    useBattleStore.setState({
      data: null,
      simulationState: {
        simTimeMs: 0,
        minTimeMs: 0,
        maxTimeMs: 0,
        isPlaying: false,
        speed: 1,
        tickAccumulatorMs: 0,
      },
      uiState: {
        sidebarMode: "story",
        mapMode: "reconstructed",
        guidedMode: false,
        hoveredEventId: null,
        selectedFormationId: null,
      },
      storyState: {
        activeBeatId: null,
        activeChapterId: null,
        lockedFormationId: null,
        overlayText: null,
      },
      selectedTime: 0,
      isPlaying: false,
      speed: 1,
      guidedMode: false,
      activeBeatId: null,
      hoveredEventId: null,
      sidebarMode: "story",
      mapMode: "reconstructed",
    });
  });

  it("sets guided mode and active beat when selecting a narrative beat", () => {
    const state = useBattleStore.getState();
    state.setData(SAMPLE_BUNDLE);
    state.selectBeat(SAMPLE_BUNDLE.narrativeBeats[0]);

    const next = useBattleStore.getState();
    expect(next.storyState.activeBeatId).toBe("beat-1");
    expect(next.uiState.guidedMode).toBe(true);
    expect(next.simulationState.simTimeMs).toBe(Date.parse("1864-11-30T13:00:00-06:00"));
  });

  it("selects chapter and jumps to its start", () => {
    const state = useBattleStore.getState();
    state.setData(SAMPLE_BUNDLE);
    state.selectChapter("chapter-1");

    const next = useBattleStore.getState();
    expect(next.storyState.activeChapterId).toBe("chapter-1");
    expect(next.simulationState.simTimeMs).toBe(Date.parse("1864-11-30T12:00:00-06:00"));
  });

  it("toggles map mode", () => {
    const state = useBattleStore.getState();
    state.setData(SAMPLE_BUNDLE);
    state.toggleMapMode("modern");

    expect(useBattleStore.getState().uiState.mapMode).toBe("modern");
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
