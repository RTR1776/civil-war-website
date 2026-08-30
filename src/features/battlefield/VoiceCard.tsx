"use client";

import { useEffect, useMemo, useState } from "react";

import { useBattleStore } from "@/lib/battle/store";
import { formatBattleClock } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface VoiceCardProps {
  bundle: ScenarioDataBundle;
  onOpenVoices: () => void;
}

/** How long an account stays on screen once the clock reaches it. */
const DWELL_MS = 13_000;

/**
 * Raises the account belonging to the current minute of the battle. Reading
 * time is real time, not sim time, so the card holds for the same interval
 * whether the chapter is racing or the viewer has paused on it.
 */
export default function VoiceCard({ bundle, onOpenVoices }: VoiceCardProps) {
  const activeVoiceId = useBattleStore((state) => state.storyState.activeVoiceId);
  const voiceCue = useBattleStore((state) => state.storyState.voiceCue);
  const voicesEnabled = useBattleStore((state) => state.uiState.voicesEnabled);

  // Which cue the viewer (or the dwell timer) has already put away. Comparing
  // against the live cue keeps visibility derived rather than toggled, so a
  // re-cue of the same account raises it again.
  const [dismissedCue, setDismissedCue] = useState<number | null>(null);

  const voice = useMemo(
    () => bundle.voices.find((entry) => entry.id === activeVoiceId) ?? null,
    [activeVoiceId, bundle.voices],
  );

  const source = useMemo(
    () => bundle.evidenceSources.find((entry) => entry.id === voice?.sourceId) ?? null,
    [bundle.evidenceSources, voice?.sourceId],
  );

  // Every cue restarts the dwell, so re-seeking onto an account re-raises it.
  useEffect(() => {
    if (!voice || !voicesEnabled) {
      return;
    }

    const timer = setTimeout(() => setDismissedCue(voiceCue), DWELL_MS);
    return () => clearTimeout(timer);
  }, [voice, voiceCue, voicesEnabled]);

  if (!voice || !voicesEnabled || dismissedCue === voiceCue) {
    return null;
  }

  return (
    <figure
      className={`voice-card side-${voice.side.toLowerCase()}`}
      data-testid="voice-card"
      key={`${voice.id}-${voiceCue}`}
    >
      <div className="voice-head">
        <span className="voice-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M20.5 3.2c-4.9.9-9 3.4-11.6 7.2-1.3 1.9-2 3.9-2.2 5.9l-2.4 3.1a.8.8 0 0 0 1.2 1l2.4-3.1c2-.2 3.9-.9 5.7-2.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path
              d="M20.5 3.2c.6 4.3-.6 7.6-2.9 9.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="voice-who">
          <strong>{voice.speaker}</strong>
          <small>{voice.role}</small>
        </div>
        <span className="voice-time">
          {voice.time ? formatBattleClock(Date.parse(voice.time)) : null}
        </span>
      </div>

      <blockquote>{voice.quote}</blockquote>

      <figcaption>
        <p className="voice-context">{voice.context}</p>
        {source ? (
          <p className="voice-source">
            {source.author}, <cite>{source.title}</cite> ({source.year})
          </p>
        ) : null}
      </figcaption>

      <div className="voice-actions">
        <button type="button" onClick={onOpenVoices}>
          All accounts
        </button>
        <button type="button" onClick={() => setDismissedCue(voiceCue)} aria-label="Dismiss account">
          Dismiss
        </button>
      </div>
    </figure>
  );
}
