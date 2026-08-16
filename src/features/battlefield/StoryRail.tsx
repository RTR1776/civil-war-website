"use client";

import { useBattleStore } from "@/lib/battle/store";
import { formatBattleClock } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface StoryRailProps {
  bundle: ScenarioDataBundle;
  onOpenEpilogue: () => void;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export default function StoryRail({ bundle, onOpenEpilogue }: StoryRailProps) {
  const activeChapterId = useBattleStore((state) => state.storyState.activeChapterId);
  const activeBeatId = useBattleStore((state) => state.storyState.activeBeatId);
  const selectChapter = useBattleStore((state) => state.selectChapter);
  const selectBeat = useBattleStore((state) => state.selectBeat);
  // Minute resolution keeps the progress bar moving without per-frame renders.
  const minuteTime = useBattleStore(
    (state) => Math.round(state.simulationState.simTimeMs / 30000) * 30000,
  );

  const chapters = bundle.manifest.chapterOrder
    .map((chapterId) => bundle.chapters.find((chapter) => chapter.id === chapterId))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter));

  return (
    <nav className="story-rail" data-testid="story-rail" aria-label="Battle chapters">
      <p className="rail-heading">Chapters</p>
      <ol>
        {chapters.map((chapter, index) => {
          const isActive = chapter.id === activeChapterId;
          const chapterStart = Date.parse(chapter.startTime);
          const chapterEnd = Date.parse(chapter.endTime);
          const chapterProgress = isActive
            ? Math.min(1, Math.max(0, (minuteTime - chapterStart) / Math.max(1, chapterEnd - chapterStart)))
            : minuteTime >= chapterEnd
              ? 1
              : 0;

          const beats = chapter.beatIds
            .map((beatId) => bundle.narrativeBeats.find((beat) => beat.id === beatId))
            .filter((beat): beat is NonNullable<typeof beat> => Boolean(beat));

          return (
            <li key={chapter.id} className={isActive ? "active" : ""}>
              <button
                type="button"
                className="rail-chapter"
                data-testid={`chapter-${chapter.id}`}
                aria-current={isActive ? "step" : undefined}
                onClick={() => selectChapter(chapter.id)}
              >
                <span className="rail-numeral">{ROMAN[index] ?? index + 1}</span>
                <span className="rail-copy">
                  <strong>{chapter.title}</strong>
                  <small>
                    {formatBattleClock(chapterStart)} – {formatBattleClock(chapterEnd)}
                  </small>
                </span>
                <span className="rail-progress" aria-hidden="true">
                  <span style={{ width: `${chapterProgress * 100}%` }} />
                </span>
              </button>

              {isActive && beats.length > 0 ? (
                <ul className="rail-beats">
                  {beats.map((beat) => (
                    <li key={beat.id}>
                      <button
                        type="button"
                        className={beat.id === activeBeatId ? "active" : ""}
                        data-testid={`beat-${beat.id}`}
                        onClick={() => selectBeat(beat)}
                      >
                        <span>{formatBattleClock(Date.parse(beat.time))}</span>
                        {beat.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="rail-chapter rail-epilogue"
            data-testid="chapter-epilogue"
            onClick={onOpenEpilogue}
          >
            <span className="rail-numeral">✦</span>
            <span className="rail-copy">
              <strong>Epilogue</strong>
              <small>The cost of five hours</small>
            </span>
          </button>
        </li>
      </ol>
    </nav>
  );
}
