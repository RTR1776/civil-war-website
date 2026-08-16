"use client";

import { useMemo } from "react";

import { casualtiesAtTime, interpolateFormationPositions } from "@/lib/battle/interpolation";
import { useBattleStore } from "@/lib/battle/store";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface IntelCardProps {
  bundle: ScenarioDataBundle;
}

export default function IntelCard({ bundle }: IntelCardProps) {
  const selectedFormationId = useBattleStore((state) => state.uiState.selectedFormationId);
  const lockedFormationId = useBattleStore((state) => state.storyState.lockedFormationId);
  const selectFormation = useBattleStore((state) => state.selectFormation);
  const lockCameraToFormation = useBattleStore((state) => state.lockCameraToFormation);
  const minuteTime = useBattleStore(
    (state) => Math.round(state.simulationState.simTimeMs / 15000) * 15000,
  );

  const formation = useMemo(
    () => bundle.formations.find((entry) => entry.id === selectedFormationId) ?? null,
    [bundle.formations, selectedFormationId],
  );

  const position = useMemo(() => {
    if (!formation) {
      return null;
    }

    return (
      interpolateFormationPositions(minuteTime, bundle.movementKeyframes)
        .find((entry) => entry.formationId === formation.id) ?? null
    );
  }, [bundle.movementKeyframes, formation, minuteTime]);

  if (!formation) {
    return null;
  }

  const casualtyRatio = (() => {
    const current = casualtiesAtTime(bundle.casualtyTimeline, minuteTime).value;
    const final = bundle.casualtyTimeline.at(-1)?.cumulativeCasualties ?? 0;
    return final > 0 ? current / final : 0;
  })();

  const estimatedLosses = Math.round((formation.casualtyEstimate ?? 0) * casualtyRatio);
  const isFollowed = lockedFormationId === formation.id;

  return (
    <aside className="intel-card" data-testid="intel-card" aria-label={`${formation.name} details`}>
      <header>
        <span className={`side-pill ${formation.side.toLowerCase()}`}>{formation.side}</span>
        <button
          type="button"
          className="intel-close"
          aria-label="Close formation details"
          onClick={() => selectFormation(null)}
        >
          ×
        </button>
      </header>
      <h3>{formation.name}</h3>
      <p className="intel-commander">{formation.commander}</p>

      <dl className="intel-grid">
        <div>
          <dt>Corps</dt>
          <dd>{formation.corps ?? "—"}</dd>
        </div>
        <div>
          <dt>Army</dt>
          <dd>{formation.army ?? "—"}</dd>
        </div>
        <div>
          <dt>Strength</dt>
          <dd>{formation.strengthEstimate.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Losses so far (est.)</dt>
          <dd className="loss-figure">{estimatedLosses.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Order</dt>
          <dd>{position?.formation?.replaceAll("-", " ") ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{position?.engaged ? "Engaged" : "Not engaged"}</dd>
        </div>
      </dl>

      {position?.confidence === "inferred" ? (
        <p className="intel-confidence">Position interpolated between documented fixes.</p>
      ) : (
        <p className="intel-confidence documented">Position from documented movement records.</p>
      )}

      {formation.notes ? <p className="intel-notes">{formation.notes}</p> : null}

      <button
        type="button"
        className={`btn-ghost intel-follow ${isFollowed ? "active" : ""}`}
        onClick={() => lockCameraToFormation(isFollowed ? null : formation.id)}
      >
        {isFollowed ? "◉ Camera following — release" : "◎ Follow with camera"}
      </button>
    </aside>
  );
}
