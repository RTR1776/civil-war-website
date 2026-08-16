"use client";

import { useBattleStore } from "@/lib/battle/store";
import { formatBattleClock } from "@/lib/battle/time";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface RecordsPanelProps {
  bundle: ScenarioDataBundle;
  validationErrors: string[];
  onClose: () => void;
}

export default function RecordsPanel({ bundle, validationErrors, onClose }: RecordsPanelProps) {
  const seek = useBattleStore((state) => state.seek);
  const setHoveredEventId = useBattleStore((state) => state.setHoveredEventId);

  return (
    <aside className="records-panel" data-testid="records-panel" aria-label="Evidence and sources">
      <header className="records-header">
        <h2>Records &amp; Evidence</h2>
        <button type="button" className="intel-close" aria-label="Close records" onClick={onClose}>
          ×
        </button>
      </header>

      <p className="records-method">
        Everything on the map is tagged <em>documented</em> (solid) or <em>inferred</em> (dashed,
        faded). Positions between documented fixes are interpolated; casualty figures between
        checkpoint totals are estimates. Live side-splits are proportional estimates — the
        documented totals appear in the epilogue.
      </p>

      <section aria-label="Evidence claims">
        <h3>Claims &amp; confidence</h3>
        <ul className="records-claims">
          {bundle.evidenceClaims.map((claim) => (
            <li key={claim.id}>
              <div className="claim-title-row">
                <strong>{claim.title}</strong>
                <span className={`confidence-chip ${claim.confidence}`}>
                  {claim.confidence === "documented" ? "Documented" : "Inferred"}
                </span>
              </div>
              <small>{claim.detail}</small>
              {claim.linkedEventIds?.[0] ? (
                <button
                  type="button"
                  className="trace-button"
                  onClick={() => {
                    const event = bundle.timelineEvents.find(
                      (entry) => entry.id === claim.linkedEventIds?.[0],
                    );
                    if (event) {
                      seek(Date.parse(event.time));
                      setHoveredEventId(event.id);
                    }
                  }}
                >
                  ⌖ Trace on timeline
                  {(() => {
                    const event = bundle.timelineEvents.find(
                      (entry) => entry.id === claim.linkedEventIds?.[0],
                    );
                    return event ? ` (${formatBattleClock(Date.parse(event.time))})` : "";
                  })()}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Source citations">
        <h3>Sources</h3>
        <ul className="records-sources">
          {bundle.evidenceSources.map((source) => (
            <li key={source.id}>
              <strong>{source.title}</strong>
              <span>
                {source.author} · {source.year}
              </span>
              <small>{source.note}</small>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open reference ↗
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Data validation">
        <h3>Data integrity</h3>
        {validationErrors.length > 0 ? (
          <ul className="records-validation">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : (
          <p className="records-ok">All schema and evidence-linkage checks passed.</p>
        )}
      </section>
    </aside>
  );
}
