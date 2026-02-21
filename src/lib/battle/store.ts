import { create } from "zustand";

import { clampTime } from "@/lib/battle/interpolation";
import type {
  ChapterScene,
  MapMode,
  NarrativeBeat,
  ScenarioDataBundle,
  SidebarMode,
  TimelineEvent,
} from "@/lib/battle/types";

const PLAYBACK_SCALE = 360;
const SIMULATION_TICK_MS = 20;

export type PlaybackSpeed = 1 | 2 | 4;

export interface SimulationState {
  simTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  tickAccumulatorMs: number;
}

export interface UIState {
  sidebarMode: SidebarMode;
  mapMode: MapMode;
  guidedMode: boolean;
  hoveredEventId: string | null;
  selectedFormationId: string | null;
}

export interface StoryState {
  activeBeatId: string | null;
  activeChapterId: string | null;
  lockedFormationId: string | null;
  overlayText: string | null;
}

interface BattlefieldState {
  data: ScenarioDataBundle | null;
  simulationState: SimulationState;
  uiState: UIState;
  storyState: StoryState;

  // Backward-compatible flat fields.
  selectedTime: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  guidedMode: boolean;
  activeBeatId: string | null;
  hoveredEventId: string | null;
  sidebarMode: SidebarMode;
  mapMode: MapMode;

  setData: (nextData: ScenarioDataBundle) => void;

  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  setPlaying: (value: boolean) => void;
  setSpeed: (nextSpeed: PlaybackSpeed) => void;
  seek: (nextTime: number) => void;
  setTime: (nextTime: number) => void;
  advanceTimeline: (realElapsedMs: number) => void;

  setGuidedMode: (value: boolean) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  toggleMapMode: (mode?: MapMode) => void;
  setHoveredEventId: (eventId: string | null) => void;
  selectFormation: (formationId: string | null) => void;

  selectBeat: (beat: NarrativeBeat) => void;
  selectChapter: (chapterId: string) => void;
  replayChapter: () => void;
  skipToPivotal: () => void;
  lockCameraToFormation: (formationId: string | null) => void;
  setStoryOverlay: (value: string | null) => void;
}

function getRange(data: ScenarioDataBundle | null): { start: number; end: number } {
  if (!data) {
    return {
      start: 0,
      end: 0,
    };
  }

  return {
    start: Date.parse(data.manifest.timeStart),
    end: Date.parse(data.manifest.timeEnd),
  };
}

function setFlatState(
  set: (partial: Partial<BattlefieldState>) => void,
  simulationState: SimulationState,
  uiState: UIState,
  storyState: StoryState,
) {
  set({
    simulationState,
    uiState,
    storyState,
    selectedTime: simulationState.simTimeMs,
    isPlaying: simulationState.isPlaying,
    speed: simulationState.speed,
    guidedMode: uiState.guidedMode,
    activeBeatId: storyState.activeBeatId,
    hoveredEventId: uiState.hoveredEventId,
    sidebarMode: uiState.sidebarMode,
    mapMode: uiState.mapMode,
  });
}

function chapterById(data: ScenarioDataBundle | null, chapterId: string | null): ChapterScene | null {
  if (!data || !chapterId) {
    return null;
  }

  return data.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}

export function resolveActiveTimelineEvent(
  currentTime: number,
  timelineEvents: TimelineEvent[],
): TimelineEvent | null {
  if (timelineEvents.length === 0) {
    return null;
  }

  let nearest = timelineEvents[0];
  let nearestDistance = Math.abs(Date.parse(nearest.time) - currentTime);

  for (const timelineEvent of timelineEvents) {
    const distance = Math.abs(Date.parse(timelineEvent.time) - currentTime);
    if (distance < nearestDistance) {
      nearest = timelineEvent;
      nearestDistance = distance;
    }
  }

  return nearestDistance <= 25 * 60 * 1000 ? nearest : null;
}

export const useBattleStore = create<BattlefieldState>((set, get) => ({
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

  setData: (nextData) => {
    const start = Date.parse(nextData.manifest.timeStart);
    const end = Date.parse(nextData.manifest.timeEnd);
    const firstChapterId = nextData.manifest.chapterOrder[0] ?? nextData.chapters[0]?.id ?? null;
    const defaultMapMode = nextData.manifest.mapModes.includes("reconstructed")
      ? "reconstructed"
      : nextData.manifest.mapModes[0] ?? "reconstructed";

    const simulationState: SimulationState = {
      simTimeMs: start,
      minTimeMs: start,
      maxTimeMs: end,
      isPlaying: false,
      speed: 1,
      tickAccumulatorMs: 0,
    };

    const uiState: UIState = {
      sidebarMode: nextData.manifest.defaultMode,
      mapMode: defaultMapMode,
      guidedMode: nextData.manifest.defaultMode === "story",
      hoveredEventId: null,
      selectedFormationId: nextData.formations[0]?.id ?? null,
    };

    const storyState: StoryState = {
      activeBeatId: null,
      activeChapterId: firstChapterId,
      lockedFormationId: null,
      overlayText: null,
    };

    set({ data: nextData });
    setFlatState(set, simulationState, uiState, storyState);
  },

  play: () => {
    const { simulationState, uiState } = get();
    if (uiState.guidedMode) {
      return;
    }

    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: true,
    };

    setFlatState(set, nextSimulation, uiState, get().storyState);
  },

  pause: () => {
    const { simulationState, uiState, storyState } = get();
    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: false,
      tickAccumulatorMs: 0,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  togglePlayback: () => {
    const { simulationState, uiState, storyState } = get();
    if (uiState.guidedMode) {
      return;
    }

    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: !simulationState.isPlaying,
      tickAccumulatorMs: simulationState.isPlaying ? 0 : simulationState.tickAccumulatorMs,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  setPlaying: (value) => {
    const { simulationState, uiState, storyState } = get();
    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: value,
      tickAccumulatorMs: value ? simulationState.tickAccumulatorMs : 0,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  setSpeed: (nextSpeed) => {
    const { simulationState, uiState, storyState } = get();
    const nextSimulation: SimulationState = {
      ...simulationState,
      speed: nextSpeed,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  seek: (nextTime) => {
    const { data, simulationState, uiState, storyState } = get();
    const { start, end } = getRange(data);
    const clamped = clampTime(nextTime, start, end);

    const nextSimulation: SimulationState = {
      ...simulationState,
      simTimeMs: clamped,
      minTimeMs: start,
      maxTimeMs: end,
      isPlaying: clamped < end ? simulationState.isPlaying : false,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  setTime: (nextTime) => {
    get().seek(nextTime);
  },

  advanceTimeline: (realElapsedMs) => {
    const { data, simulationState, uiState, storyState } = get();
    if (!data || !simulationState.isPlaying || uiState.guidedMode) {
      return;
    }

    const frameDuration = Math.max(0, Math.min(realElapsedMs, 120));
    let accumulator = simulationState.tickAccumulatorMs + frameDuration;
    let simTime = simulationState.simTimeMs;

    while (accumulator >= SIMULATION_TICK_MS) {
      accumulator -= SIMULATION_TICK_MS;
      simTime += SIMULATION_TICK_MS * PLAYBACK_SCALE * simulationState.speed;
    }

    const nextTime = clampTime(simTime, simulationState.minTimeMs, simulationState.maxTimeMs);

    const nextSimulation: SimulationState = {
      ...simulationState,
      simTimeMs: nextTime,
      tickAccumulatorMs: accumulator,
      isPlaying: nextTime < simulationState.maxTimeMs,
    };

    setFlatState(set, nextSimulation, uiState, storyState);
  },

  setGuidedMode: (value) => {
    const { simulationState, uiState, storyState } = get();

    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: value ? false : simulationState.isPlaying,
      tickAccumulatorMs: value ? 0 : simulationState.tickAccumulatorMs,
    };

    const nextUiState: UIState = {
      ...uiState,
      guidedMode: value,
      sidebarMode: value ? "story" : uiState.sidebarMode,
    };

    setFlatState(set, nextSimulation, nextUiState, storyState);
  },

  setSidebarMode: (mode) => {
    const { simulationState, uiState, storyState } = get();
    const nextUiState: UIState = {
      ...uiState,
      sidebarMode: mode,
      guidedMode: mode === "story" ? true : uiState.guidedMode,
    };

    const nextSimulation: SimulationState = {
      ...simulationState,
      isPlaying: mode === "story" ? false : simulationState.isPlaying,
    };

    setFlatState(set, nextSimulation, nextUiState, storyState);
  },

  toggleMapMode: (mode) => {
    const { data, simulationState, uiState, storyState } = get();
    if (!data) {
      return;
    }

    const candidate: MapMode = mode
      ?? (uiState.mapMode === "reconstructed" ? "modern" : "reconstructed");

    if (!data.manifest.mapModes.includes(candidate)) {
      return;
    }

    const nextUiState: UIState = {
      ...uiState,
      mapMode: candidate,
    };

    setFlatState(set, simulationState, nextUiState, storyState);
  },

  setHoveredEventId: (eventId) => {
    const { simulationState, uiState, storyState } = get();
    const nextUiState: UIState = {
      ...uiState,
      hoveredEventId: eventId,
    };

    setFlatState(set, simulationState, nextUiState, storyState);
  },

  selectFormation: (formationId) => {
    const { simulationState, uiState, storyState } = get();
    const nextUiState: UIState = {
      ...uiState,
      selectedFormationId: formationId,
    };

    setFlatState(set, simulationState, nextUiState, storyState);
  },

  selectBeat: (beat) => {
    const { data, simulationState, uiState, storyState } = get();
    const beatTime = Date.parse(beat.time);

    const chapterId =
      data?.chapters.find((chapter) => chapter.beatIds.includes(beat.id))?.id
      ?? storyState.activeChapterId;

    const nextStoryState: StoryState = {
      ...storyState,
      activeBeatId: beat.id,
      activeChapterId: chapterId,
      overlayText: beat.title,
      lockedFormationId: storyState.lockedFormationId,
    };

    const nextUiState: UIState = {
      ...uiState,
      guidedMode: true,
      sidebarMode: "story",
    };

    const nextSimulation: SimulationState = {
      ...simulationState,
      simTimeMs: beatTime,
      isPlaying: false,
      tickAccumulatorMs: 0,
    };

    setFlatState(set, nextSimulation, nextUiState, nextStoryState);
  },

  selectChapter: (chapterId) => {
    const { data, simulationState, uiState, storyState } = get();
    const chapter = chapterById(data, chapterId);
    if (!chapter) {
      return;
    }

    const start = Date.parse(chapter.startTime);
    const firstBeatId = chapter.beatIds[0] ?? storyState.activeBeatId;

    const nextSimulation: SimulationState = {
      ...simulationState,
      simTimeMs: start,
      isPlaying: false,
      tickAccumulatorMs: 0,
    };

    const nextUiState: UIState = {
      ...uiState,
      guidedMode: true,
      sidebarMode: "story",
    };

    const nextStoryState: StoryState = {
      ...storyState,
      activeChapterId: chapterId,
      activeBeatId: firstBeatId,
      overlayText: chapter.summary,
    };

    setFlatState(set, nextSimulation, nextUiState, nextStoryState);
  },

  replayChapter: () => {
    const { data, storyState } = get();
    const chapter = chapterById(data, storyState.activeChapterId);
    if (!chapter) {
      return;
    }

    get().seek(Date.parse(chapter.startTime));
  },

  skipToPivotal: () => {
    const { data, storyState } = get();
    const chapter = chapterById(data, storyState.activeChapterId);
    if (!chapter || !chapter.pivotalEventId) {
      return;
    }

    const event = data?.timelineEvents.find((item) => item.id === chapter.pivotalEventId);
    if (!event) {
      return;
    }

    get().seek(Date.parse(event.time));
  },

  lockCameraToFormation: (formationId) => {
    const { simulationState, uiState, storyState } = get();
    const nextStoryState: StoryState = {
      ...storyState,
      lockedFormationId: formationId,
    };

    setFlatState(set, simulationState, uiState, nextStoryState);
  },

  setStoryOverlay: (value) => {
    const { simulationState, uiState, storyState } = get();
    const nextStoryState: StoryState = {
      ...storyState,
      overlayText: value,
    };

    setFlatState(set, simulationState, uiState, nextStoryState);
  },
}));
