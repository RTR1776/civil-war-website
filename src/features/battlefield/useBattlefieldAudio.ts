"use client";

import { useEffect, useRef } from "react";

import { BattlefieldAudio } from "@/lib/audio/battlefieldAudio";
import { buildIntensityCurve, smoothIntensityAt } from "@/lib/battle/intensity";
import { useBattleStore } from "@/lib/battle/store";
import { nightness } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

/** How often the engine is told where the battle stands. */
const UPDATE_MS = 250;

/**
 * Runs the synthesized field audio alongside the simulation. The store is read
 * transiently on a timer rather than subscribed to, so the sound follows the
 * clock without re-rendering anything.
 */
export function useBattlefieldAudio(
  bundle: ScenarioDataBundle | null,
  enabled: boolean,
  volume: number,
) {
  const engineRef = useRef<BattlefieldAudio | null>(null);

  useEffect(() => {
    if (!enabled || !bundle) {
      engineRef.current?.stop();
      engineRef.current = null;
      return;
    }

    const engine = new BattlefieldAudio();
    engineRef.current = engine;
    engine.setVolume(volume);

    const curve = buildIntensityCurve(bundle.casualtyTimeline);
    let cancelled = false;

    const pump = () => {
      const timeMs = useBattleStore.getState().simulationState.simTimeMs;
      engine.update({
        intensity: smoothIntensityAt(curve, timeMs),
        night: nightness(timeMs),
      });
    };

    // The first update lands before the fade-in so the level is already right.
    pump();
    const timer = setInterval(pump, UPDATE_MS);

    void engine.start().catch(() => {
      // A browser that refuses the context (no gesture, or no Web Audio) just
      // leaves the site silent; nothing else depends on it.
    });

    // A tab in the background should not keep firing muskets.
    const onVisibility = () => {
      if (cancelled) {
        return;
      }
      engine.setVolume(document.hidden ? 0 : volume);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      engine.stop();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
    // Volume is applied through the effect below so a slider drag does not
    // rebuild the audio graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, enabled]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);
}
