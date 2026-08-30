"use client";

import { useEffect, useRef } from "react";

import { encodePermalink, type PermalinkView } from "@/lib/battle/permalink";
import { useBattleStore } from "@/lib/battle/store";

/**
 * Safari caps replaceState at roughly a hundred calls per thirty seconds, and
 * the clock can cross several battle-minutes a second in story mode, so the
 * address bar is rewritten no faster than this.
 */
const WRITE_INTERVAL_MS = 1000;

export interface PermalinkInputs {
  view: PermalinkView;
  sound: boolean;
  /** Held back until the viewer has left the title card. */
  active: boolean;
}

/** Read the live state and return the link that would reproduce it. */
export function currentPermalinkUrl(view: PermalinkView, sound: boolean): string {
  const { simulationState, uiState, storyState } = useBattleStore.getState();
  const hash = encodePermalink({
    timeMs: simulationState.simTimeMs,
    view,
    formationId: uiState.selectedFormationId ?? undefined,
    voiceId: storyState.activeVoiceId ?? undefined,
    sound: sound || undefined,
  });

  return `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
}

/**
 * Keeps the address bar describing the moment on screen, so any frame of the
 * battle can be linked to. Runs off a store subscription rather than React
 * state — nothing here should cause a render.
 */
export function usePermalink({ view, sound, active }: PermalinkInputs) {
  const latest = useRef({ view, sound, active });

  // The writer below runs off a store subscription, not a render, so it reads
  // the mode flags through a ref that an effect keeps current.
  useEffect(() => {
    latest.current = { view, sound, active };
  }, [active, sound, view]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let lastWrite = 0;
    let lastHash = "";

    const write = () => {
      const settings = latest.current;
      if (!settings.active) {
        return;
      }

      const now = Date.now();
      if (now - lastWrite < WRITE_INTERVAL_MS) {
        return;
      }

      const { simulationState, uiState, storyState } = useBattleStore.getState();
      const hash = encodePermalink({
        timeMs: simulationState.simTimeMs,
        view: settings.view,
        formationId: uiState.selectedFormationId ?? undefined,
        voiceId: storyState.activeVoiceId ?? undefined,
        sound: settings.sound || undefined,
      });

      if (hash === lastHash) {
        return;
      }

      lastWrite = now;
      lastHash = hash;
      // An empty hash still has to keep the path and query intact.
      window.history.replaceState(
        null,
        "",
        hash || `${window.location.pathname}${window.location.search}`,
      );
    };

    const unsubscribe = useBattleStore.subscribe(write);
    // Modes and the sound toggle change outside the store, so poll as well.
    const timer = setInterval(write, WRITE_INTERVAL_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
}
