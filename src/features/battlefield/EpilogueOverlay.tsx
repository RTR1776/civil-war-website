"use client";

import {
  DOCUMENTED_CASUALTIES,
  EPILOGUE_NOTES,
  EPILOGUE_SOURCE_IDS,
  FALLEN_GENERALS,
} from "@/features/battlefield/content/epilogue";
import type { ScenarioDataBundle } from "@/lib/battle/types";

interface EpilogueOverlayProps {
  bundle: ScenarioDataBundle;
  onReplay: () => void;
  onExplore: () => void;
  onClose: () => void;
}

export default function EpilogueOverlay({ bundle, onReplay, onExplore, onClose }: EpilogueOverlayProps) {
  const citedSources = bundle.evidenceSources.filter((source) =>
    EPILOGUE_SOURCE_IDS.includes(source.id),
  );

  return (
    <div className="epilogue-overlay" data-testid="epilogue-overlay" role="dialog" aria-label="Epilogue">
      <div className="epilogue-scroll">
        <button type="button" className="epilogue-close" aria-label="Close epilogue" onClick={onClose}>
          ×
        </button>

        <p className="intro-kicker">Nine o&rsquo;clock · the field falls quiet</p>
        <h2 className="epilogue-title">The Cost of Five Hours</h2>
        <div className="intro-rule" aria-hidden="true">
          <span />
          <em>✦</em>
          <span />
        </div>

        <div className="epilogue-totals">
          {DOCUMENTED_CASUALTIES.map((record) => (
            <section key={record.side} className="epilogue-side">
              <h3>{record.side}</h3>
              <p className="epilogue-engaged">{record.engaged}</p>
              <p className="epilogue-total">{record.total.toLocaleString()}</p>
              <dl>
                <div>
                  <dt>Killed</dt>
                  <dd>{record.killed.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Wounded</dt>
                  <dd>{record.wounded.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Missing / captured</dt>
                  <dd>{record.missing.toLocaleString()}</dd>
                </div>
              </dl>
            </section>
          ))}
        </div>

        <h3 className="epilogue-generals-heading">The Fallen Generals</h3>
        <div className="generals-grid">
          {FALLEN_GENERALS.map((general) => (
            <article key={general.name} className="general-card">
              <span className="general-star" aria-hidden="true">
                ★
              </span>
              <h4>{general.name}</h4>
              <p className="general-rank">{general.rank}</p>
              <p className="general-command">{general.command}</p>
              <p className="general-fate">{general.fate}</p>
            </article>
          ))}
        </div>

        <div className="epilogue-notes">
          {EPILOGUE_NOTES.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>

        {citedSources.length > 0 ? (
          <p className="epilogue-citation">
            Figures per {citedSources.map((source) => `${source.author} (${source.year})`).join("; ")}.
          </p>
        ) : null}

        <div className="intro-actions">
          <button type="button" className="btn-primary" onClick={onReplay}>
            ↻ Replay the battle
          </button>
          <button type="button" className="btn-ghost" onClick={onExplore}>
            Explore the field
          </button>
        </div>
      </div>
    </div>
  );
}
