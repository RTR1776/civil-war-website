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

/** Sim-time multiplier for free-analysis playback (1x). */
const FREE_PLAYBACK_SCALE = 360;
/** In story mode every chapter plays for roughly this long at 1x. */
const STORY_SECONDS_PER_CHAPTER = 32;
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
  /** Set once guided playback has run the full timeline to its end. */
  storyComplete: boolean;
}

interface BattlefieldState {
  data: ScenarioDataBundle | null;
  simulationState: SimulationState;
  uiState: UIState;
  storyState: StoryState;

  setData: (nextData: ScenarioDataBundle) => void;

  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  setSpeed: (nextSpeed: PlaybackSpeed) => void;
  seek: (nextTime: number) => void;
  advanceTimeline: (realElapsedMs: number) => void;

  setGuidedMode: (value: boolean) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  toggleMapMode: (mode?: MapMode) => void;
  setHoveredEventId: (eventId: string | null) => void;
  selectFormation: (formationId: string | null) => void;

  beginStory: () => void;
  acknowledgeStoryComplete: () => void;
  selectBeat: (beat: NarrativeBeat) => void;
  selectChapter: (chapterId: string) => void;
  replayChapter: () => void;
  skipToPivotal: () => void;
  lockCameraToFormation: (formationId: string | null) => void;
}

function getRange(data: ScenarioDataBundle | null): { start: number; end: number } {
  if (!data) {
    return { start: 0, end: 0 };
  }

  return {
    start: Date.parse(data.manifest.timeStart),
    end: Date.parse(data.manifest.timeEnd),
  };
}

function chapterById(data: ScenarioDataBundle | null, chapterId: string | null): ChapterScene | null {
  if (!data || !chapterId) {
    return null;
  }

  return data.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}

/** The chapter whose window contains the given time (last one whose start has passed). */
export function chapterAtTime(data: ScenarioDataBundle, timeMs: number): ChapterScene | null {
  let candidate: ChapterScene | null = null;

  for (const chapterId of data.manifest.chapterOrder) {
    const chapter = data.chapters.find((entry) => entry.id === chapterId);
    if (!chapter) {
      continue;
    }

    if (Date.parse(chapter.startTime) <= timeMs) {
      candidate = chapter;
    }
  }

  return candidate ?? data.chapters[0] ?? null;
}

/** The most recent narrative beat the timeline has crossed. */
export function beatAtTime(data: ScenarioDataBundle, timeMs: number): NarrativeBeat | null {
  let candidate: NarrativeBeat | null = null;
  let candidateTime = -Infinity;

  for (const beat of data.narrativeBeats) {
    const beatTime = Date.parse(beat.time);
    if (beatTime <= timeMs && beatTime > candidateTime) {
      candidate = beat;
      candidateTime = beatTime;
    }
  }

  return candidate;
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

function syncStoryPointers(
  data: ScenarioDataBundle | null,
  timeMs: number,
  storyState: StoryState,
): StoryState {
  if (!data) {
    return storyState;
  }

  const chapter = chapterAtTime(data, timeMs);
  const beat = beatAtTime(data, timeMs);

  if (
    storyState.activeChapterId === (chapter?.id ?? null)
    && storyState.activeBeatId === (beat?.id ?? null)
  ) {
    return storyState;
  }

  return {
    ...storyState,
    activeChapterId: chapter?.id ?? null,
    activeBeatId: beat?.id ?? null,
  };
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
    guidedMode: true,
    hoveredEventId: null,
    selectedFormationId: null,
  },
  storyState: {
    activeBeatId: null,
    activeChapterId: null,
    lockedFormationId: null,
    storyComplete: false,
  },

  setData: (nextData) => {
    const start = Date.parse(nextData.manifest.timeStart);
    const end = Date.parse(nextData.manifest.timeEnd);
    const firstChapterId = nextData.manifest.chapterOrder[0] ?? nextData.chapters[0]?.id ?? null;

    set({
      data: nextData,
      simulationState: {
        simTimeMs: start,
        minTimeMs: start,
        maxTimeMs: end,
        isPlaying: false,
        speed: 1,
        tickAccumulatorMs: 0,
      },
      uiState: {
        sidebarMode: nextData.manifest.defaultMode,
        mapMode: "reconstructed",
        guidedMode: nextData.manifest.defaultMode === "story",
        hoveredEventId: null,
        selectedFormationId: null,
      },
      storyState: {
        activeBeatId: null,
        activeChapterId: firstChapterId,
        lockedFormationId: null,
        storyComplete: false,
      },
    });
  },

  play: () => {
    const { simulationState } = get();
    const atEnd = simulationState.simTimeMs >= simulationState.maxTimeMs;

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: atEnd ? simulationState.minTimeMs : simulationState.simTimeMs,
        isPlaying: true,
      },
    });
  },

  pause: () => {
    const { simulationState } = get();
    set({
      simulationState: {
        ...simulationState,
        isPlaying: false,
        tickAccumulatorMs: 0,
      },
    });
  },

  togglePlayback: () => {
    const { simulationState } = get();
    if (simulationState.isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  setSpeed: (nextSpeed) => {
    const { simulationState } = get();
    set({ simulationState: { ...simulationState, speed: nextSpeed } });
  },

  seek: (nextTime) => {
    const { data, simulationState, storyState } = get();
    const { start, end } = getRange(data);
    const clamped = clampTime(nextTime, start, end);

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: clamped,
        minTimeMs: start,
        maxTimeMs: end,
        isPlaying: clamped < end ? simulationState.isPlaying : false,
      },
      storyState: syncStoryPointers(data, clamped, storyState),
    });
  },

  advanceTimeline: (realElapsedMs) => {
    const { data, simulationState, uiState, storyState } = get();
    if (!data || !simulationState.isPlaying) {
      return;
    }

    // Story mode paces each chapter to a similar screen duration; free mode
    // runs at a fixed sim-time multiplier.
    let ratePerMs = FREE_PLAYBACK_SCALE;
    if (uiState.guidedMode) {
      const chapter = chapterById(data, storyState.activeChapterId)
        ?? chapterAtTime(data, simulationState.simTimeMs);
      if (chapter) {
        const spanMs = Math.max(60_000, Date.parse(chapter.endTime) - Date.parse(chapter.startTime));
        ratePerMs = spanMs / (STORY_SECONDS_PER_CHAPTER * 1000);
      }
    }

    const frameDuration = Math.max(0, Math.min(realElapsedMs, 120));
    let accumulator = simulationState.tickAccumulatorMs + frameDuration;
    let simTime = simulationState.simTimeMs;

    while (accumulator >= SIMULATION_TICK_MS) {
      accumulator -= SIMULATION_TICK_MS;
      simTime += SIMULATION_TICK_MS * ratePerMs * simulationState.speed;
    }

    const nextTime = clampTime(simTime, simulationState.minTimeMs, simulationState.maxTimeMs);
    const reachedEnd = nextTime >= simulationState.maxTimeMs;

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: nextTime,
        tickAccumulatorMs: accumulator,
        isPlaying: !reachedEnd,
      },
      storyState: {
        ...syncStoryPointers(data, nextTime, storyState),
        storyComplete: storyState.storyComplete || (reachedEnd && uiState.guidedMode),
      },
    });
  },

  setGuidedMode: (value) => {
    const { uiState } = get();
    set({ uiState: { ...uiState, guidedMode: value } });
  },

  setSidebarMode: (mode) => {
    const { uiState } = get();
    set({
      uiState: {
        ...uiState,
        sidebarMode: mode,
        guidedMode: mode === "story" ? true : mode === "analyze" ? false : uiState.guidedMode,
      },
    });
  },

  toggleMapMode: (mode) => {
    const { data, uiState } = get();
    if (!data) {
      return;
    }

    const candidate: MapMode = mode
      ?? (uiState.mapMode === "reconstructed" ? "modern" : "reconstructed");

    if (!data.manifest.mapModes.includes(candidate)) {
      return;
    }

    set({ uiState: { ...uiState, mapMode: candidate } });
  },

  setHoveredEventId: (eventId) => {
    const { uiState } = get();
    if (uiState.hoveredEventId === eventId) {
      return;
    }
    set({ uiState: { ...uiState, hoveredEventId: eventId } });
  },

  selectFormation: (formationId) => {
    const { uiState } = get();
    set({ uiState: { ...uiState, selectedFormationId: formationId } });
  },

  beginStory: () => {
    const { data, simulationState, uiState, storyState } = get();
    if (!data) {
      return;
    }

    const { start } = getRange(data);

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: start,
        isPlaying: true,
        tickAccumulatorMs: 0,
      },
      uiState: {
        ...uiState,
        sidebarMode: "story",
        guidedMode: true,
      },
      storyState: {
        ...syncStoryPointers(data, start, storyState),
        lockedFormationId: null,
        storyComplete: false,
      },
    });
  },

  acknowledgeStoryComplete: () => {
    const { storyState } = get();
    if (!storyState.storyComplete) {
      return;
    }
    set({ storyState: { ...storyState, storyComplete: false } });
  },

  selectBeat: (beat) => {
    const { data, simulationState, uiState, storyState } = get();
    const beatTime = Date.parse(beat.time);

    const chapterId =
      data?.chapters.find((chapter) => chapter.beatIds.includes(beat.id))?.id
      ?? storyState.activeChapterId;

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: data
          ? clampTime(beatTime, simulationState.minTimeMs, simulationState.maxTimeMs)
          : beatTime,
        tickAccumulatorMs: 0,
      },
      uiState: {
        ...uiState,
        sidebarMode: "story",
        guidedMode: true,
      },
      storyState: {
        ...storyState,
        activeBeatId: beat.id,
        activeChapterId: chapterId,
      },
    });
  },

  selectChapter: (chapterId) => {
    const { data, simulationState, uiState, storyState } = get();
    const chapter = chapterById(data, chapterId);
    if (!chapter) {
      return;
    }

    const start = Date.parse(chapter.startTime);

    set({
      simulationState: {
        ...simulationState,
        simTimeMs: start,
        tickAccumulatorMs: 0,
      },
      uiState: {
        ...uiState,
        sidebarMode: "story",
        guidedMode: true,
      },
      storyState: {
        ...storyState,
        activeChapterId: chapterId,
        activeBeatId: chapter.beatIds[0] ?? null,
      },
    });
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
    const { storyState } = get();
    set({ storyState: { ...storyState, lockedFormationId: formationId } });
  },
}));
