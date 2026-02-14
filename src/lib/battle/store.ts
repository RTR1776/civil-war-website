import { create } from "zustand";

import type {
  BattleDataBundle,
  CameraPose,
  NarrativeBeat,
  TimelineEvent,
} from "@/lib/battle/types";
import { clampTime } from "@/lib/battle/interpolation";

const PLAYBACK_SCALE = 360;

export type PlaybackSpeed = 1 | 2 | 4;

interface BattlefieldState {
  data: BattleDataBundle | null;
  selectedTime: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  guidedMode: boolean;
  activeBeatId: string | null;
  cameraPoseOverride: CameraPose | null;
  hoveredEventId: string | null;
  setData: (nextData: BattleDataBundle) => void;
  setTime: (nextTime: number) => void;
  setSpeed: (nextSpeed: PlaybackSpeed) => void;
  togglePlayback: () => void;
  setPlaying: (value: boolean) => void;
  advanceTimeline: (realElapsedMs: number) => void;
  setGuidedMode: (value: boolean) => void;
  selectBeat: (beat: NarrativeBeat) => void;
  clearCameraOverride: () => void;
  setHoveredEventId: (eventId: string | null) => void;
}

function getRange(data: BattleDataBundle | null): { start: number; end: number } {
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
  selectedTime: 0,
  isPlaying: false,
  speed: 1,
  guidedMode: false,
  activeBeatId: null,
  cameraPoseOverride: null,
  hoveredEventId: null,
  setData: (nextData) => {
    const start = Date.parse(nextData.manifest.timeStart);
    set({
      data: nextData,
      selectedTime: start,
      isPlaying: false,
      activeBeatId: null,
      cameraPoseOverride: null,
      hoveredEventId: null,
    });
  },
  setTime: (nextTime) => {
    const { data } = get();
    const { start, end } = getRange(data);
    set({
      selectedTime: clampTime(nextTime, start, end),
    });
  },
  setSpeed: (nextSpeed) => {
    set({ speed: nextSpeed });
  },
  togglePlayback: () => {
    const { isPlaying } = get();
    set({ isPlaying: !isPlaying });
  },
  setPlaying: (value) => {
    set({ isPlaying: value });
  },
  advanceTimeline: (realElapsedMs) => {
    const { data, isPlaying, selectedTime, speed, guidedMode } = get();
    if (!data || !isPlaying) {
      return;
    }

    if (guidedMode) {
      return;
    }

    const { start, end } = getRange(data);
    const increment = realElapsedMs * PLAYBACK_SCALE * speed;
    const candidate = selectedTime + increment;
    const nextTime = clampTime(candidate, start, end);

    set({
      selectedTime: nextTime,
      isPlaying: nextTime < end,
    });
  },
  setGuidedMode: (value) => {
    set({ guidedMode: value, isPlaying: value ? false : get().isPlaying });
  },
  selectBeat: (beat) => {
    set({
      guidedMode: true,
      activeBeatId: beat.id,
      cameraPoseOverride: beat.cameraPose,
      selectedTime: Date.parse(beat.time),
      isPlaying: false,
    });
  },
  clearCameraOverride: () => {
    set({ cameraPoseOverride: null });
  },
  setHoveredEventId: (eventId) => {
    set({ hoveredEventId: eventId });
  },
}));
