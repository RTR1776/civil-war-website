"use client";

import { useEffect, useState } from "react";

interface IntroOverlayProps {
  onBeginStory: () => void;
  onExplore: () => void;
  reducedMotion: boolean;
}

function useCountUp(target: number, durationMs: number, enabled: boolean): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let raf = 0;
    let start = 0;

    const tick = (now: number) => {
      if (start === 0) {
        start = now;
      }
      const linear = Math.min(1, (now - start) / durationMs);
      setProgress(1 - (1 - linear) ** 3);
      if (linear < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, enabled]);

  return enabled ? Math.round(target * progress) : target;
}

export default function IntroOverlay({ onBeginStory, onExplore, reducedMotion }: IntroOverlayProps) {
  const federals = useCountUp(27000, 2100, !reducedMotion);
  const confederates = useCountUp(20000, 2100, !reducedMotion);
  const casualties = useCountUp(9300, 2600, !reducedMotion);
  const generals = useCountUp(6, 2900, !reducedMotion);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onBeginStory();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBeginStory]);

  return (
    <div className="intro-overlay" data-testid="intro-overlay">
      <div className="intro-inner">
        <p className="intro-kicker">November 30, 1864 · Franklin, Tennessee</p>
        <h1 className="intro-title">The Battle of Franklin</h1>
        <div className="intro-rule" aria-hidden="true">
          <span />
          <em>✦</em>
          <span />
        </div>
        <p className="intro-sub">
          At four o&rsquo;clock on a warm Indian-summer afternoon, the Army of Tennessee stepped off
          across two miles of open ground — into five of the most violent hours of the Civil War,
          fought on into total darkness.
        </p>

        <dl className="intro-stats">
          <div>
            <dt>Federals entrenched</dt>
            <dd>{federals.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Confederates advancing</dt>
            <dd>~{confederates.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Casualties by nightfall</dt>
            <dd>~{casualties.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Confederate generals lost</dt>
            <dd>{generals}</dd>
          </div>
        </dl>

        <div className="intro-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="intro-begin"
            onClick={onBeginStory}
          >
            ▶ Play the battle
          </button>
          <button type="button" className="btn-ghost" data-testid="intro-explore" onClick={onExplore}>
            Explore the field freely
          </button>
        </div>

        <p className="intro-hint">
          <kbd>Space</kbd> play / pause · <kbd>←</kbd><kbd>→</kbd> step time · drag to pan · scroll to zoom
        </p>
      </div>
    </div>
  );
}
